import { addMinutes } from './datetime'
import { findConflict, fuzzyFind, matchPattern } from '../db/repo'
import { formatDateZh, weekdayOf, WEEKDAY_ZH } from '../lib/date'
import type { LessonDraft, ParseContext, ParseResult } from './types'
import { emptyResult } from './types'

export interface AIConfig {
  provider: 'anthropic' | 'openai' | 'none'
  apiKey?: string
  model?: string
}

// ---------------------------------------------------------------------------
// 給模型的輸出格式
// ---------------------------------------------------------------------------

interface AILesson {
  kind?: 'class' | 'event'
  title?: string
  headcount?: number
  students?: string[]
  date: string
  start_time?: string
  end_time?: string
  location?: string
  course?: string
  group?: string
  is_substitute?: boolean
  substitute_for?: string
  topic?: string
  prev_topic?: string
  note?: string
}

interface AIResponse {
  intent: 'create' | 'cancel' | 'reschedule' | 'query' | 'unknown'
  lessons?: AILesson[]
  cancel?: { date: string; group?: string; start_time?: string }[]
  reschedule?: { from_date: string; group?: string; to_date?: string; start_time?: string; end_time?: string }[]
  answer?: string
  note_to_user?: string
}

const SCHEMA_DOC = `
只輸出 JSON，不要有任何說明文字或 markdown 標記。格式：
{
  "intent": "create" | "cancel" | "reschedule" | "query" | "unknown",
  "lessons": [                       // intent=create 時填
    {
      "kind": "class" | "event",     // 一般課程 / 大活動（營隊、參訪、體驗營…）
      "title": "大活動名稱",          // kind=event 時填，例如「中鋼員工子女營」
      "date": "YYYY-MM-DD",          // 必填
      "start_time": "HH:MM",
      "end_time": "HH:MM",
      "location": "地點名稱",
      "course": "課程名稱",
      "group": "班級名稱",           // kind=event 時留空，大活動不綁班級
      "headcount": 80,               // 學生人數
      "students": ["王小明", "…"],   // 代課或大活動的臨時名單（不屬於任何常態班級）
      "is_substitute": true/false,
      "substitute_for": "被代課老師",
      "topic": "這堂課要上的內容",
      "prev_topic": "使用者說的『上次上的內容』",
      "note": "其他備註"
    }
  ],
  "cancel": [ { "date": "YYYY-MM-DD", "group": "班級", "start_time": "HH:MM" } ],
  "reschedule": [ { "from_date": "YYYY-MM-DD", "group": "班級", "to_date": "YYYY-MM-DD", "start_time": "HH:MM", "end_time": "HH:MM" } ],
  "answer": "intent=query 時，用繁體中文直接回答",
  "note_to_user": "任何你不確定、需要使用者確認的地方（繁體中文，可省略）"
}

規則：
- 重複性排課請自行展開成多筆 lessons，上限 60 筆。
- 使用者沒講班級/地點/課程時，用「固定課表」推斷；推斷不出來就留空，不要亂猜。
- 「不是代課」要輸出 is_substitute: false。
- 「上次…」講的是先前那一堂的內容，放進 prev_topic，不要放進 topic。
- 地點、課程、班級一律用下方已知清單裡的既有名稱；真的沒有才用新名稱。
- 出現「大活動、營隊、體驗營、參訪、講座、工作坊」這類字眼，或人數明顯偏多（20 人以上），
  就是 kind="event"：不要綁班級，把人數放進 headcount，活動名稱放進 title。
- 代課帶的通常不是老師自己的班級，學生姓名放進 students，不要塞進 group。
- 同一個班級每週上的課程可能不同（這週 Minecraft、下週 Scratch）。
  使用者沒明講課程時，寧可把 course 留空，也不要照上週猜。
`

function contextPrompt(ctx: ParseContext): string {
  const wd = WEEKDAY_ZH[weekdayOf(ctx.today)]
  const lines: string[] = []
  lines.push(`今天是 ${ctx.today}（星期${wd}）。使用者是教小朋友樂高教育 / Minecraft 教育版程式設計的老師。`)
  lines.push(`預設課程長度 ${ctx.defaultMinutes} 分鐘。`)
  lines.push('')
  lines.push(`已知地點：${ctx.locations.map((l) => l.name).join('、') || '（無）'}`)
  lines.push(`已知課程：${ctx.courses.map((c) => c.name).join('、') || '（無）'}`)
  lines.push(`已知班級：${ctx.groups.map((g) => g.name).join('、') || '（無）'}`)
  lines.push('')
  if (ctx.patterns.length) {
    lines.push('固定課表（沒特別說明時就照這個）：')
    for (const p of ctx.patterns.filter((x) => x.active && !x.deleted)) {
      const g = ctx.groups.find((x) => x.id === p.group_id)?.name ?? '?'
      const co = ctx.courses.find((x) => x.id === p.course_id)?.name ?? '?'
      const lo = ctx.locations.find((x) => x.id === p.location_id)?.name ?? '?'
      lines.push(`- 每週${WEEKDAY_ZH[p.weekday]} ${p.start_time}-${p.end_time} ${lo} ${co} ${g}`)
    }
    lines.push('')
  }
  const recent = [...ctx.lessons]
    .filter((l) => !l.deleted)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 25)
  if (recent.length) {
    lines.push('最近的課程紀錄（新到舊）：')
    for (const l of recent) {
      const g = ctx.groups.find((x) => x.id === l.group_id)?.name ?? ''
      const co = ctx.courses.find((x) => x.id === l.course_id)?.name ?? ''
      lines.push(
        `- ${l.date} ${l.start_time}-${l.end_time} ${co} ${g}` +
        `${l.is_substitute ? ' [代課]' : ''}${l.topic ? ` 內容:${l.topic}` : ''}` +
        `${l.status === 'cancelled' ? ' [已停課]' : ''}`,
      )
    }
  }
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// API 呼叫
// ---------------------------------------------------------------------------

async function callAnthropic(cfg: AIConfig, system: string, user: string): Promise<string> {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': cfg.apiKey!,
      'anthropic-version': '2023-06-01',
      // 允許瀏覽器直接呼叫（否則會被 CORS 擋下）
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: cfg.model || 'claude-sonnet-4-5-20250929',
      max_tokens: 4000,
      system,
      messages: [{ role: 'user', content: user }],
    }),
  })
  if (!r.ok) throw new Error(`Anthropic API ${r.status}: ${(await r.text()).slice(0, 300)}`)
  const j = await r.json()
  return (j.content ?? []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('')
}

async function callOpenAI(cfg: AIConfig, system: string, user: string): Promise<string> {
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify({
      model: cfg.model || 'gpt-4o-mini',
      response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    }),
  })
  if (!r.ok) throw new Error(`OpenAI API ${r.status}: ${(await r.text()).slice(0, 300)}`)
  const j = await r.json()
  return j.choices?.[0]?.message?.content ?? ''
}

function extractJson(s: string): any {
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/)
  const body = fence ? fence[1] : s
  const start = body.indexOf('{')
  const end = body.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('AI 沒有回傳 JSON')
  return JSON.parse(body.slice(start, end + 1))
}

// ---------------------------------------------------------------------------

export function aiAvailable(cfg: AIConfig | undefined): boolean {
  return !!cfg && cfg.provider !== 'none' && !!cfg.apiKey
}

export async function parseWithAI(
  input: string, ctx: ParseContext, cfg: AIConfig,
): Promise<ParseResult> {
  const system =
    '你是一個排課助理，負責把老師用口語講的排課需求轉成結構化 JSON。' +
    '一律使用繁體中文。' + SCHEMA_DOC
  const user = contextPrompt(ctx) + '\n\n---\n老師說：\n' + input

  const text = cfg.provider === 'openai'
    ? await callOpenAI(cfg, system, user)
    : await callAnthropic(cfg, system, user)

  const data = extractJson(text) as AIResponse
  return aiToResult(data, ctx, input)
}

function resolveName<T extends { id: string; name: string; aliases?: string[]; deleted: 0 | 1 }>(
  rows: T[], name?: string,
): { id?: string; newName?: string } {
  if (!name?.trim()) return {}
  const hit = fuzzyFind(rows as any, name)
  if (hit) return { id: hit.rec.id }
  return { newName: name.trim() }
}

export function aiToResult(data: AIResponse, ctx: ParseContext, raw: string): ParseResult {
  const res = emptyResult(raw)
  res.source = 'ai'
  res.needsAI = false
  res.intent = (data.intent as any) ?? 'unknown'
  if (data.note_to_user) res.warnings.push(data.note_to_user)

  if (data.intent === 'query') {
    res.answer = data.answer || '（AI 沒有給出答案）'
    res.confidence = 0.75
    return res
  }

  if (data.intent === 'cancel' && data.cancel?.length) {
    for (const c of data.cancel) {
      const g = resolveName(ctx.groups, c.group)
      const hits = ctx.lessons.filter(
        (l) => !l.deleted && l.status !== 'cancelled' && l.date === c.date &&
          (!g.id || l.group_id === g.id) && (!c.start_time || l.start_time === c.start_time),
      )
      for (const l of hits) res.cancels.push({ lesson: l })
    }
    res.confidence = res.cancels.length ? 0.8 : 0.4
    if (!res.cancels.length) res.warnings.push('找不到符合條件的課程可以停課。')
    return res
  }

  if (data.intent === 'reschedule' && data.reschedule?.length) {
    for (const r of data.reschedule) {
      const g = resolveName(ctx.groups, r.group)
      const target = ctx.lessons.find(
        (l) => !l.deleted && l.date === r.from_date && (!g.id || l.group_id === g.id),
      )
      if (target) {
        res.reschedules.push({
          lesson: target, date: r.to_date, start_time: r.start_time, end_time: r.end_time,
        })
      }
    }
    res.confidence = res.reschedules.length ? 0.8 : 0.4
    return res
  }

  const lessons = (data.lessons ?? []).slice(0, 200)
  for (const l of lessons) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(l.date ?? '')) continue
    const loc = resolveName(ctx.locations, l.location)
    const cou = resolveName(ctx.courses, l.course)
    const grp = resolveName(ctx.groups, l.group)

    const pattern = l.kind === 'event'
      ? null
      : matchPattern(ctx.patterns, l.date, l.start_time, l.end_time, {
          locationId: loc.id, courseId: cou.id,
        })
    const start = l.start_time || pattern?.start_time || '14:00'
    const end = l.end_time || (l.start_time ? addMinutes(start, ctx.defaultMinutes)
      : pattern?.end_time || addMinutes(start, ctx.defaultMinutes))

    const isEvent = l.kind === 'event'
    const d: LessonDraft = {
      kind: isEvent ? 'event' : 'class',
      title: isEvent ? l.title?.trim() || undefined : undefined,
      headcount: l.headcount && l.headcount > 0 ? Math.round(l.headcount) : undefined,
      guest_students: Array.isArray(l.students) ? l.students.filter((x) => x?.trim()) : [],
      date: l.date,
      start_time: start,
      end_time: end,
      is_substitute: isEvent ? 0 : (l.is_substitute ? 1 : 0),
      substitute_for: l.substitute_for,
      topic: l.topic?.trim() || undefined,
      prev_topic_manual: l.prev_topic?.trim() || undefined,
      note: l.note?.trim() || undefined,
      sources: {
        date: 'stated',
        time: l.start_time ? 'stated' : pattern ? 'pattern' : 'default',
        location: loc.id || loc.newName ? 'stated' : pattern?.location_id ? 'pattern' : 'default',
        course: cou.id || cou.newName ? 'stated' : pattern?.course_id ? 'pattern' : 'default',
        group: grp.id || grp.newName ? 'stated' : pattern?.group_id ? 'pattern' : 'default',
        substitute: l.is_substitute === undefined ? 'default' : 'stated',
      },
      creates: { locations: [], courses: [], groups: [] },
      pattern_id: pattern?.id,
    }
    if (loc.id) d.location_id = loc.id
    else if (loc.newName) { d.location_name = loc.newName; d.creates.locations.push(loc.newName) }
    else if (pattern?.location_id) d.location_id = pattern.location_id

    if (cou.id) d.course_id = cou.id
    else if (cou.newName) { d.course_name = cou.newName; d.creates.courses.push(cou.newName) }
    else if (pattern?.course_id) d.course_id = pattern.course_id

    if (!isEvent) {
      if (grp.id) d.group_id = grp.id
      else if (grp.newName) { d.group_name = grp.newName; d.creates.groups.push(grp.newName) }
      else if (pattern?.group_id) d.group_id = pattern.group_id
    }

    const conflict = findConflict(ctx.lessons, d.date, d.start_time, d.end_time)
    if (conflict) d.conflict = conflict
    res.drafts.push(d)
  }

  res.intent = res.drafts.length ? 'create' : 'unknown'
  res.confidence = res.drafts.length ? 0.8 : 0.2
  if (!res.drafts.length && !res.answer) {
    res.warnings.push('AI 看不懂這句話要做什麼，換個說法試試？')
  }
  return res
}

export function summarizeForUser(res: ParseResult, ctx: ParseContext): string {
  if (res.answer) return res.answer
  if (res.intent === 'cancel') {
    return res.cancels.length
      ? `要停掉 ${res.cancels.length} 堂課：` +
        res.cancels.map((c) => formatDateZh(c.lesson.date)).join('、')
      : '沒有找到要停的課。'
  }
  if (res.intent === 'reschedule') {
    return res.reschedules
      .map((r) => `${formatDateZh(r.lesson.date)} → ${r.date ? formatDateZh(r.date) : ''} ${r.start_time ?? ''}`)
      .join('\n')
  }
  if (res.drafts.length) {
    const g = res.drafts[0].group_id
      ? ctx.groups.find((x) => x.id === res.drafts[0].group_id)?.name
      : res.drafts[0].group_name
    return `準備新增 ${res.drafts.length} 堂課${g ? `（${g}）` : ''}，確認後按「加入行事曆」。`
  }
  return '沒有可以執行的動作。'
}

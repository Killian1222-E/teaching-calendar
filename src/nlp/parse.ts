import { addDays, formatDateZh, timeToMin, todayStr, weekdayOf } from '../lib/date'
import {
  coursesUsedByGroup, expandRecurring, findConflict, latestTopicOfGroup,
  matchPattern, normalizeName,
} from '../db/repo'
import { addMinutes, parseDates, parseTimes } from './datetime'
import { Consumer, canonicalize } from './normalize'
import { emptyResult, type Intent, type LessonDraft, type ParseContext, type ParseResult } from './types'

// ---------------------------------------------------------------------------
// 內建課程別名 — 讓第一次使用、資料庫還空的時候也認得出來
// ---------------------------------------------------------------------------
const BUILTIN_COURSES: { canonical: string; re: RegExp }[] = [
  { canonical: 'Minecraft 教育版', re: /minecraft\s*(教育版)?|麥塊|我的世界|當個創世神|創世神|(?<![a-z])mc(?![a-z])/i },
  { canonical: '樂高教育', re: /樂高\s*(教育)?|lego|wedo|spike\s*prime|spike|ev3|mindstorms|動力機械|簡單機械/i },
  { canonical: 'Scratch', re: /scratch|史克拉奇/i },
  { canonical: 'Python', re: /python|派森/i },
  { canonical: 'micro:bit', re: /micro:?bit|微位元/i },
  { canonical: 'App Inventor', re: /app\s*inventor/i },
]

/** 大活動關鍵字：企業營隊、體驗營、參訪這類一次性的大場子 */
const EVENT_RE = /大活動|營隊|夏令營|冬令營|冬令班|寒假營|暑期營|體驗營|體驗活動|工作坊|講座|研習|參訪|園遊會|成果展|發表會|市集|競賽|比賽|嘉年華|活動/
/** 「80人」「共 80 位」「80 個小朋友」 */
const HEADCOUNT_RE = /(?:共|約|大概|總共)?\s*(\d{1,4})\s*(?:個|位|名)?\s*(?:人|位|名|學生|小朋友|孩子|小孩)/
/** 「中鋼大活動」→ 抓出「中鋼」當活動名稱 */
const EVENT_TITLE_RE = /([一-龥A-Za-z0-9]{2,14}?)(?:的)?\s*(?:大活動|營隊|夏令營|冬令營|體驗營|工作坊|講座|研習|參訪|園遊會|成果展|發表會|活動)/

const LOCATION_SUFFIX = /([一-龥A-Za-z0-9]{1,10}?(?:分校|校區|教室|中心|分部|會館|國小|國中|小學|安親班|補習班|館))/g
const GROUP_PATTERNS = [
  /((?:學生)?組\s*[A-Za-z0-9]{1,3})/g,
  /(學生組\s*[一二三四五六七八九十甲乙丙丁]{1,2})/g,
  /([A-Za-z0-9]{1,3}\s*組(?![別長員]))/g,
  /([一-龥A-Za-z0-9]{1,6}班(?!級))/g,
]

// ---------------------------------------------------------------------------

interface Located { text: string; index: number; length: number }

function locate(hay: string, needle: string): Located | null {
  if (!needle) return null
  const i = hay.toLowerCase().indexOf(needle.toLowerCase())
  if (i < 0) return null
  return { text: hay.slice(i, i + needle.length), index: i, length: needle.length }
}

/** 在文字中找出已知實體（比對名稱與別名），取最長命中 */
function findKnown<T extends { id: string; name: string; aliases?: string[]; deleted: 0 | 1 }>(
  text: string, rows: T[],
): { rec: T; at: Located } | null {
  let best: { rec: T; at: Located } | null = null
  for (const r of rows) {
    if (r.deleted) continue
    for (const cand of [r.name, ...(r.aliases ?? [])]) {
      const at = locate(text, cand)
      if (at && at.length >= 2 && (!best || at.length > best.at.length)) best = { rec: r, at }
    }
  }
  return best
}

function stripLeadingCourse(s: string, ctx: ParseContext): string {
  let out = s.trim()
  for (const b of BUILTIN_COURSES) {
    const re = new RegExp('^\\s*(?:' + b.re.source + ')\\s*[的:：]?\\s*', 'i')
    if (re.test(out)) { out = out.replace(re, ''); break }
  }
  for (const c of ctx.courses) {
    for (const cand of [c.name, ...(c.aliases ?? [])]) {
      if (out.toLowerCase().startsWith(cand.toLowerCase())) {
        out = out.slice(cand.length).replace(/^\s*[的:：]?\s*/, '')
        break
      }
    }
  }
  return out.replace(/^(上|教|的|是|了)+/, '').trim()
}

// ---------------------------------------------------------------------------
// 主解析
// ---------------------------------------------------------------------------

export function parse(input: string, ctx: ParseContext): ParseResult {
  const raw = input.trim()
  const res = emptyResult(raw)
  if (!raw) return res

  const text = canonicalize(raw)
  const c = new Consumer(text)

  // ---- 意圖：先看關鍵字 --------------------------------------------------
  const cancelRe = /停課|取消|請假|不上了?|休課|放假|課取消/
  const rescheduleRe = /改到|改成|延到|順延到|提前到|挪到|移到|改期|調到/
  const queryRe = /(什麼|甚麼|哪些|哪一|哪天|幾點|多少|誰|嗎|\?|？)/
  const queryVerb = /查詢|查一下|列出|告訴我|看一下|有沒有|上到哪|進度到哪/

  let intent: Intent = 'unknown'
  if (cancelRe.test(text)) intent = 'cancel'
  else if (rescheduleRe.test(text)) intent = 'reschedule'
  else if (queryVerb.test(text) || (queryRe.test(text) && !/[上下]課|排|新增|加/.test(text))) intent = 'query'

  // ---- 代課 --------------------------------------------------------------
  let isSub: 0 | 1 = 0
  let subStated = false
  let substituteFor: string | undefined
  const noSub = text.match(/(?:不是|不算|非|沒有|不用|不需要|不為)\s*代課/)
  if (noSub) { isSub = 0; subStated = true; c.consumeMatch(noSub) }
  else {
    const yesSub = text.match(/(?:幫\s*([一-龥A-Za-z]{1,6})\s*)?代課|代班|代上/)
    if (yesSub) {
      isSub = 1; subStated = true
      if (yesSub[1]) substituteFor = yesSub[1]
      c.consumeMatch(yesSub)
    }
  }

  // ---- 上次進度 ----------------------------------------------------------
  let prevTopic: string | undefined
  const prevM = text.match(/上(?:一)?次\s*(?:上(?:的|了)?(?:是)?)?\s*[:：]?\s*([^,，。;；]+)/)
  if (prevM) {
    const cleaned = stripLeadingCourse(prevM[1], ctx)
    if (cleaned && !queryRe.test(cleaned)) prevTopic = cleaned
    c.consumeMatch(prevM)
  }

  // ---- 這堂課的內容 ------------------------------------------------------
  let topic: string | undefined
  const topicM = text.match(
    /(?:這堂|本堂|本次|這次|當天|今天)?\s*(?:要)?\s*(?<!上)(?:教|課程內容|內容|進度|主題)\s*[:：]?\s*([^,，。;；]+)/,
  )
  if (topicM) {
    const cleaned = stripLeadingCourse(topicM[1], ctx)
    if (cleaned) topic = cleaned
    c.consumeMatch(topicM)
  }

  // ---- 時間（先於日期，避免 1300-1430 被當成月/日）------------------------
  const times = parseTimes(text, c)

  // ---- 日期 --------------------------------------------------------------
  const dateRes = parseDates(text, ctx.today, c)

  // ---- 實體：地點 / 課程 / 班級 -----------------------------------------
  let locationId: string | undefined
  let locationName: string | undefined
  const knownLoc = findKnown(text, ctx.locations)
  if (knownLoc) { locationId = knownLoc.rec.id; c.consume(knownLoc.at.index, knownLoc.at.length) }
  else {
    for (const m of text.matchAll(LOCATION_SUFFIX)) {
      const cand = m[1].trim()
      if (cand.length >= 2 && !/^(上課|下課|這個|那個)/.test(cand)) {
        locationName = cand
        c.consumeMatch(m)
        break
      }
    }
  }

  let courseId: string | undefined
  let courseName: string | undefined
  const knownCourse = findKnown(text, ctx.courses)
  if (knownCourse) { courseId = knownCourse.rec.id; c.consume(knownCourse.at.index, knownCourse.at.length) }
  else {
    for (const b of BUILTIN_COURSES) {
      const m = text.match(b.re)
      if (m) { courseName = b.canonical; c.consumeMatch(m); break }
    }
  }

  let groupId: string | undefined
  let groupName: string | undefined
  const knownGroup = findKnown(text, ctx.groups)
  if (knownGroup) { groupId = knownGroup.rec.id; c.consume(knownGroup.at.index, knownGroup.at.length) }
  else {
    outer: for (const re of GROUP_PATTERNS) {
      for (const m of text.matchAll(re)) {
        const cand = m[1].replace(/\s+/g, '')
        if (cand.length >= 2) { groupName = cand; c.consumeMatch(m); break outer }
      }
    }
  }

  // ---- 大活動與人數 ------------------------------------------------------
  const eventM = text.match(EVENT_RE)
  const isEvent = !!eventM
  let headcount: number | undefined
  const hcM = text.match(HEADCOUNT_RE)
  if (hcM) {
    const n = parseInt(hcM[1], 10)
    if (n > 0 && n <= 5000) { headcount = n; c.consumeMatch(hcM) }
  }

  let eventTitle: string | undefined
  if (isEvent) {
    c.consumeMatch(eventM)
    const tm = text.match(EVENT_TITLE_RE)
    if (tm) {
      const cand = tm[1].trim()
      // 前綴如果本身就是地點/課程/班級，就不要拿來當活動名稱
      const clash =
        (locationId && ctx.locations.find((x) => x.id === locationId)?.name === cand) ||
        !!fuzzyKnownName(cand, ctx)
      if (!clash && cand.length >= 2) {
        eventTitle = cand
        c.consumeMatch(tm)
      }
    }
  }

  // ---- 備註 --------------------------------------------------------------
  let note: string | undefined
  const noteM = text.match(/(?:備註|註記|note)\s*[:：]?\s*([^,，。;；]+)/i)
  if (noteM) { note = noteM[1].trim(); c.consumeMatch(noteM) }

  res.unresolved = c.leftovers()

  // =========================================================================
  // 查詢
  // =========================================================================
  if (intent === 'query') {
    res.intent = 'query'
    res.answer = answerQuery(text, ctx, { groupId, courseId, locationId, dateRes })
    res.confidence = res.answer ? 0.8 : 0.3
    res.needsAI = !res.answer
    return res
  }

  // =========================================================================
  // 停課 / 取消
  // =========================================================================
  if (intent === 'cancel') {
    res.intent = 'cancel'
    const targetDates = dateRes.dates.length
      ? dateRes.dates
      : dateRes.range
        ? datesInRange(dateRes.range.from, dateRes.range.to)
        : []
    const hits = ctx.lessons.filter(
      (l) =>
        !l.deleted && l.status !== 'cancelled' &&
        (targetDates.length ? targetDates.includes(l.date) : false) &&
        (!groupId || l.group_id === groupId) &&
        (!courseId || l.course_id === courseId) &&
        (!locationId || l.location_id === locationId) &&
        (!times.start || l.start_time === times.start),
    )
    res.cancels = hits.map((l) => ({ lesson: l }))
    if (!targetDates.length) {
      res.warnings.push('沒抓到要停課的日期，請補上日期。')
      res.confidence = 0.3
      res.needsAI = true
    } else if (!hits.length) {
      res.warnings.push(`${targetDates.map((d) => formatDateZh(d)).join('、')} 找不到符合的課程。`)
      res.confidence = 0.5
    } else {
      res.confidence = 0.85
      res.needsAI = false
    }
    return res
  }

  // =========================================================================
  // 改期
  // =========================================================================
  if (intent === 'reschedule') {
    res.intent = 'reschedule'
    // 「原日期 改到 新日期」：取兩個日期，第一個是原本的
    if (dateRes.dates.length >= 2) {
      const [fromD, toD] = dateRes.dates
      const target = ctx.lessons.find(
        (l) => !l.deleted && l.date === fromD && (!groupId || l.group_id === groupId),
      )
      if (target) {
        res.reschedules = [{ lesson: target, date: toD, start_time: times.start, end_time: times.end }]
        res.confidence = 0.8
        res.needsAI = false
        return res
      }
    }
    if (dateRes.dates.length === 1 && (times.start || groupId)) {
      const d = dateRes.dates[0]
      const target = ctx.lessons.find(
        (l) => !l.deleted && l.date === d && (!groupId || l.group_id === groupId),
      )
      if (target && times.start) {
        res.reschedules = [{ lesson: target, start_time: times.start, end_time: times.end }]
        res.confidence = 0.7
        res.needsAI = false
        return res
      }
    }
    res.warnings.push('看得出是要改期，但沒辦法確定要改哪一堂、改到什麼時候。')
    res.confidence = 0.35
    res.needsAI = true
    return res
  }

  // =========================================================================
  // 新增課程
  // =========================================================================
  let dates: string[] = dateRes.dates
  let recurringUsed = false
  if (dateRes.recurring) {
    dates = expandRecurring(dateRes.recurring)
    recurringUsed = true
  } else if (dateRes.range && !dates.length) {
    // 只給了月份範圍，若能從固定課表推出星期就展開
    const wds = inferWeekdaysFromPatterns(ctx, { groupId, courseId, locationId, start: times.start })
    if (wds.length) {
      dates = expandRecurring({ weekdays: wds, from: dateRes.range.from, to: dateRes.range.to })
      recurringUsed = true
      res.warnings.push(`依固定課表推斷為每週${wds.map((w) => '日一二三四五六'[w]).join('、')}。`)
    }
  }

  if (!dates.length) {
    res.intent = 'unknown'
    res.warnings.push('沒有讀到日期。')
    res.confidence = 0.15
    res.needsAI = true
    return res
  }

  if (dates.length > 200) {
    dates = dates.slice(0, 200)
    res.warnings.push('日期超過 200 筆，只取前 200 筆。')
  }

  res.intent = 'create'
  res.drafts = dates.map((date) =>
    buildDraft(date, ctx, {
      times, locationId, locationName, courseId, courseName, groupId, groupName,
      isSub, subStated, substituteFor, topic, prevTopic, note,
      isEvent, eventTitle, headcount,
    }),
  )

  // 信心分數
  let score = 0.4
  if (times.start) score += 0.2
  if (res.drafts[0]?.group_id || res.drafts[0]?.group_name) score += 0.15
  if (res.drafts[0]?.course_id || res.drafts[0]?.course_name) score += 0.1
  if (res.drafts[0]?.location_id || res.drafts[0]?.location_name) score += 0.1
  if (recurringUsed) score += 0.05
  score -= Math.min(0.25, res.unresolved.length * 0.08)
  res.confidence = Math.max(0, Math.min(1, score))
  res.needsAI = res.confidence < 0.55

  if (!times.start) res.warnings.push('沒有讀到時間，先用預設時段，請確認。')

  const d0 = res.drafts[0]
  if (isEvent) {
    if (!headcount) res.warnings.push('大活動沒有讀到人數，記得補上有幾位學生。')
    if (!eventTitle) res.warnings.push('沒有讀到活動名稱，加入後可以再補。')
  } else {
    if (!d0?.group_id && !d0?.group_name) {
      res.warnings.push('沒有讀到班級，也無法從固定課表推斷。')
    }
    // 同一個班級每週課程可能不同，沒講就不要亂猜
    if (d0?.group_id && !d0.course_id && !d0.course_name) {
      const used = coursesUsedByGroup(d0.group_id, ctx.lessons)
        .map((id) => ctx.courses.find((c2) => c2.id === id)?.name)
        .filter(Boolean)
      if (used.length > 1) {
        res.warnings.push(
          `這一班上過 ${used.join('、')}，每週不一定一樣，請指定這次要上哪一門。`,
        )
      } else if (!used.length) {
        res.warnings.push('沒有讀到課程種類。')
      }
    }
    // 從固定課表帶入課程，但這班其實會輪替時，提醒一下
    if (d0?.sources.course === 'pattern' && d0.group_id) {
      const used = coursesUsedByGroup(d0.group_id, ctx.lessons)
      if (used.length > 1) {
        res.warnings.push(
          `課程是照固定課表帶入「${ctx.courses.find((c2) => c2.id === d0.course_id)?.name ?? ''}」，這一班有輪替過其他課程，請確認。`,
        )
      }
    }
  }
  return res
}

// ---------------------------------------------------------------------------

interface DraftInput {
  times: ReturnType<typeof parseTimes>
  locationId?: string; locationName?: string
  courseId?: string; courseName?: string
  groupId?: string; groupName?: string
  isSub: 0 | 1; subStated: boolean; substituteFor?: string
  topic?: string; prevTopic?: string; note?: string
  isEvent: boolean; eventTitle?: string; headcount?: number
}

/** 這個名字是不是已知的地點/課程/班級 */
function fuzzyKnownName(name: string, ctx: ParseContext): boolean {
  const n = normalizeName(name)
  if (!n) return false
  const pools = [ctx.locations, ctx.courses, ctx.groups] as { name: string; aliases?: string[] }[][]
  return pools.some((rows) =>
    rows.some((r) => [r.name, ...(r.aliases ?? [])].some((x) => normalizeName(x) === n)),
  )
}

function buildDraft(date: string, ctx: ParseContext, i: DraftInput): LessonDraft {
  const sources: LessonDraft['sources'] = { date: 'stated' }
  let start = i.times.start
  let end = i.times.end

  // 大活動是一次性的，不套用固定課表
  const pattern = i.isEvent
    ? null
    : matchPattern(ctx.patterns, date, start, end, {
        locationId: i.locationId, courseId: i.courseId,
      })

  if (start) sources.time = 'stated'
  else if (pattern) { start = pattern.start_time; end = pattern.end_time; sources.time = 'pattern' }
  else { start = i.isEvent ? '09:00' : '14:00'; sources.time = 'default' }

  if (!end) {
    if (i.times.durationMin) end = addMinutes(start, i.times.durationMin)
    else if (pattern && sources.time === 'pattern') end = pattern.end_time
    // 大活動通常是半天起跳
    else end = addMinutes(start, i.isEvent ? 180 : ctx.defaultMinutes)
  }

  const d: LessonDraft = {
    kind: i.isEvent ? 'event' : 'class',
    title: i.eventTitle,
    headcount: i.headcount,
    guest_students: [],
    date,
    start_time: start,
    end_time: end,
    is_substitute: i.isEvent ? 0 : i.isSub,
    substitute_for: i.substituteFor,
    topic: i.topic,
    prev_topic_manual: i.prevTopic,
    note: i.note,
    sources,
    creates: { locations: [], courses: [], groups: [] },
  }

  // 班級：明講 > 固定課表（大活動不綁班級）
  if (i.isEvent) { /* 大活動沒有固定班級，人數另外記 */ }
  else if (i.groupId) { d.group_id = i.groupId; d.sources.group = 'stated' }
  else if (i.groupName) {
    d.group_name = i.groupName; d.sources.group = 'stated'; d.creates.groups.push(i.groupName)
  } else if (pattern?.group_id) {
    d.group_id = pattern.group_id; d.sources.group = 'pattern'; d.pattern_id = pattern.id
  }

  if (i.locationId) { d.location_id = i.locationId; d.sources.location = 'stated' }
  else if (i.locationName) {
    d.location_name = i.locationName; d.sources.location = 'stated'; d.creates.locations.push(i.locationName)
  } else if (pattern?.location_id) {
    d.location_id = pattern.location_id; d.sources.location = 'pattern'
  }

  if (i.courseId) { d.course_id = i.courseId; d.sources.course = 'stated' }
  else if (i.courseName) {
    d.course_name = i.courseName; d.sources.course = 'stated'; d.creates.courses.push(i.courseName)
  } else if (pattern?.course_id) {
    d.course_id = pattern.course_id; d.sources.course = 'pattern'
  }

  d.sources.substitute = i.subStated ? 'stated' : 'default'
  if (pattern) d.pattern_id = pattern.id

  const conflict = findConflict(ctx.lessons, date, d.start_time, d.end_time)
  if (conflict) d.conflict = conflict

  return d
}

function inferWeekdaysFromPatterns(
  ctx: ParseContext,
  f: { groupId?: string; courseId?: string; locationId?: string; start?: string },
): number[] {
  const hits = ctx.patterns.filter(
    (p) =>
      !p.deleted && p.active &&
      (!f.groupId || p.group_id === f.groupId) &&
      (!f.courseId || p.course_id === f.courseId) &&
      (!f.locationId || p.location_id === f.locationId) &&
      (!f.start || p.start_time === f.start),
  )
  return [...new Set(hits.map((p) => p.weekday))].sort()
}

function datesInRange(from: string, to: string): string[] {
  const out: string[] = []
  let cur = from
  let guard = 0
  while (cur <= to && guard++ < 400) { out.push(cur); cur = addDays(cur, 1) }
  return out
}

// ---------------------------------------------------------------------------
// 查詢回答
// ---------------------------------------------------------------------------

function answerQuery(
  text: string, ctx: ParseContext,
  f: { groupId?: string; courseId?: string; locationId?: string; dateRes: ReturnType<typeof parseDates> },
): string | undefined {
  const nameOf = (id?: string, kind: 'g' | 'c' | 'l' = 'g') => {
    if (!id) return ''
    const src = kind === 'g' ? ctx.groups : kind === 'c' ? ctx.courses : ctx.locations
    return src.find((x) => x.id === id)?.name ?? ''
  }

  // 「上次上什麼 / 上到哪」
  if (/上(?:一)?次|上到哪|進度/.test(text)) {
    if (f.groupId) {
      const prev = latestTopicOfGroup(f.groupId, ctx.lessons)
      if (prev) {
        return `${nameOf(f.groupId)} 上次是 ${formatDateZh(prev.date!)}，上到「${prev.topic}」。`
      }
      return `${nameOf(f.groupId)} 目前沒有任何已記錄內容的課程。`
    }
    const lines = ctx.groups
      .map((g) => ({ g, p: latestTopicOfGroup(g.id, ctx.lessons) }))
      .filter((x) => x.p)
      .map((x) => `・${x.g.name}：${formatDateZh(x.p!.date!)} 「${x.p!.topic}」`)
    return lines.length ? '各班最近進度：\n' + lines.join('\n') : undefined
  }

  // 「X 有哪些課 / 幾點」
  let from = ctx.today
  let to = addDays(ctx.today, 13)
  if (f.dateRes.dates.length) { from = f.dateRes.dates[0]; to = f.dateRes.dates[f.dateRes.dates.length - 1] }
  else if (f.dateRes.range) { from = f.dateRes.range.from; to = f.dateRes.range.to }

  const hits = ctx.lessons
    .filter(
      (l) =>
        !l.deleted && l.date >= from && l.date <= to && l.status !== 'cancelled' &&
        (!f.groupId || l.group_id === f.groupId) &&
        (!f.courseId || l.course_id === f.courseId) &&
        (!f.locationId || l.location_id === f.locationId),
    )
    .sort((a, b) => a.date.localeCompare(b.date) || timeToMin(a.start_time) - timeToMin(b.start_time))

  if (!hits.length) {
    return `${formatDateZh(from)} 到 ${formatDateZh(to)} 之間沒有排課。`
  }
  const lines = hits.slice(0, 30).map((l) => {
    const bits = [
      formatDateZh(l.date),
      `${l.start_time}-${l.end_time}`,
      nameOf(l.location_id, 'l'),
      nameOf(l.course_id, 'c'),
      nameOf(l.group_id, 'g'),
      l.is_substitute ? '[代課]' : '',
    ].filter(Boolean)
    return '・' + bits.join(' ')
  })
  const head = hits.length > 30 ? `共 ${hits.length} 堂，列出前 30 堂：\n` : ''
  return head + lines.join('\n')
}

// ---------------------------------------------------------------------------

export function buildContext(partial: Omit<ParseContext, 'today' | 'defaultMinutes'> & {
  today?: string; defaultMinutes?: number
}): ParseContext {
  return {
    today: partial.today ?? todayStr(),
    defaultMinutes: partial.defaultMinutes ?? 90,
    locations: partial.locations,
    courses: partial.courses,
    groups: partial.groups,
    patterns: partial.patterns,
    lessons: partial.lessons,
  }
}

/** 給 UI 用的摘要文字 */
export function describeDraft(d: LessonDraft, ctx: ParseContext): string {
  const g = d.group_id ? ctx.groups.find((x) => x.id === d.group_id)?.name : d.group_name
  const co = d.course_id ? ctx.courses.find((x) => x.id === d.course_id)?.name : d.course_name
  const lo = d.location_id ? ctx.locations.find((x) => x.id === d.location_id)?.name : d.location_name
  return [
    formatDateZh(d.date), `${d.start_time}-${d.end_time}`, lo, co, g,
    d.is_substitute ? '代課' : '',
  ].filter(Boolean).join(' · ')
}

export { weekdayOf, normalizeName }

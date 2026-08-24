// ---------------------------------------------------------------------------
// 多行貼上解析
//
// 老師之間互相找代課，訊息幾乎都長這樣：
//
//   9/5(六):
//   第一班0830-1000
//   第二班1030-1200
//   9/8(二)18:30-20:00
//   都在三民上課
//
// 也就是「日期標題 + 底下好幾個時段」，最後再補一句適用於全部的條件。
// 這支解析器就是專門吃這種格式，把它展開成一堆課程草稿。
// ---------------------------------------------------------------------------

import { findConflict, matchPattern } from '../db/repo'
import { addMinutes, parseAllTimeRanges, parseDates, type TimeRange } from './datetime'
import {
  matchCourse, matchGroup, matchLocation, matchSessionLabel, matchSubstitute,
  type EntityHit,
} from './entities'
import { canonicalize } from './normalize'
import { emptyResult, type LessonDraft, type ParseContext, type ParseResult } from './types'

interface LineInfo {
  raw: string
  dates: string[]
  times: TimeRange[]
  loc: EntityHit
  course: EntityHit
  group: EntityHit
  sub: ReturnType<typeof matchSubstitute>
  session?: string
  /** 這一行有沒有帶任何我們認得的資訊 */
  informative: boolean
}

interface Entry {
  date: string
  time: TimeRange
  loc: EntityHit
  course: EntityHit
  group: EntityHit
  isSub: 0 | 1
  subStated: boolean
  subFor?: string
  note?: string
}

const pick = (...hits: EntityHit[]): EntityHit =>
  hits.find((h) => h.id || h.name) ?? {}

/**
 * 嘗試把整段文字當成「多筆課程」來解析。
 * 判斷不出至少兩筆就回傳 null，讓一般的單句解析器接手。
 */
export function parseBlock(input: string, ctx: ParseContext): ParseResult | null {
  const text = canonicalize(input)

  // 這些意圖交給單句解析器，多行模式只負責「一次新增很多堂」
  if (/停課|取消|請假|休課|改到|改成|延到|挪到|改期|調到/.test(text)) return null

  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  if (!lines.length) return null

  const infos: LineInfo[] = lines.map((raw) => {
    const dateRes = parseDates(raw, ctx.today)
    // 出現「每週…」「9/1到9/30」這種規則，交給單句解析器處理
    const hasRule = !!dateRes.recurring || !!dateRes.range
    const times = parseAllTimeRanges(raw)
    const loc = matchLocation(raw, ctx)
    const course = matchCourse(raw, ctx)
    const group = matchGroup(raw, ctx)
    const sub = matchSubstitute(raw)
    const session = matchSessionLabel(raw)
    return {
      raw,
      dates: hasRule ? [] : dateRes.dates,
      times,
      loc, course, group, sub, session,
      informative:
        (!hasRule && dateRes.dates.length > 0) || times.length > 0 ||
        !!loc.id || !!loc.name || !!course.id || !!course.name ||
        !!group.id || !!group.name || sub.stated,
    }
  })

  const totalTimes = infos.reduce((n, i) => n + i.times.length, 0)
  const totalDates = infos.reduce((n, i) => n + i.dates.length, 0)
  // 少於兩個時段就不算「一次多筆」，讓原本的解析器處理
  if (totalTimes < 2 || totalDates < 1) return null

  // ---- 全域條件：沒有日期也沒有時間的那幾行（例如「都在三民上課」）----
  const global = { loc: {} as EntityHit, course: {} as EntityHit, group: {} as EntityHit,
                   isSub: 0 as 0 | 1, subStated: false, subFor: undefined as string | undefined }
  for (const i of infos) {
    if (i.dates.length || i.times.length) continue
    if (!i.informative) continue
    global.loc = pick(global.loc, i.loc)
    global.course = pick(global.course, i.course)
    global.group = pick(global.group, i.group)
    if (i.sub.stated && !global.subStated) {
      global.isSub = i.sub.isSub
      global.subStated = true
      global.subFor = i.sub.forWhom
    }
  }

  // ---- 逐行展開 ----------------------------------------------------------
  const entries: Entry[] = []
  const orphanTimes: string[] = []
  let pending: string[] = []   // 目前生效的日期（來自最近一個日期標題）

  for (const i of infos) {
    if (i.dates.length) pending = i.dates
    if (!i.times.length) continue
    if (!pending.length) { orphanTimes.push(i.raw); continue }

    for (const date of pending) {
      for (const time of i.times) {
        entries.push({
          date,
          time,
          loc: i.loc,
          course: i.course,
          group: i.group,
          isSub: i.sub.stated ? i.sub.isSub : global.isSub,
          subStated: i.sub.stated || global.subStated,
          subFor: i.sub.forWhom ?? global.subFor,
          note: i.session,
        })
      }
    }
    // 日期標題底下可以掛好幾行時段，所以 pending 不清掉；
    // 但同一行如果自己就帶了日期，後面的純時段行仍沿用它。
  }

  if (entries.length < 2) return null

  // ---- 轉成草稿 ----------------------------------------------------------
  const res = emptyResult(input)
  res.intent = 'create'
  res.source = 'rules'
  res.needsAI = false

  const seen = new Set<string>()
  const pool = ctx.lessons

  for (const e of entries) {
    const key = `${e.date}|${e.time.start}`
    if (seen.has(key)) continue
    seen.add(key)

    const loc = pick(e.loc, global.loc)
    const course = pick(e.course, global.course)
    const group = pick(e.group, global.group)

    const start = e.time.start
    const end = e.time.end ?? addMinutes(start, ctx.defaultMinutes)

    // 代課帶的不是自己的班級，所以不套用固定課表的推斷
    const pattern = e.isSub ? null : matchPattern(ctx.patterns, e.date, start, end, {
      locationId: loc.id, courseId: course.id,
    })

    const d: LessonDraft = {
      kind: 'class',
      guest_students: [],
      date: e.date,
      start_time: start,
      end_time: end,
      is_substitute: e.isSub,
      substitute_for: e.subFor,
      note: e.note,
      sources: {
        date: 'stated',
        time: 'stated',
        substitute: e.subStated ? 'stated' : 'default',
      },
      creates: { locations: [], courses: [], groups: [] },
      pattern_id: pattern?.id,
    }

    if (loc.id) { d.location_id = loc.id; d.sources.location = 'stated' }
    else if (loc.name) {
      d.location_name = loc.name; d.sources.location = 'stated'
      d.creates.locations.push(loc.name)
    } else if (pattern?.location_id) {
      d.location_id = pattern.location_id; d.sources.location = 'pattern'
    }

    if (course.id) { d.course_id = course.id; d.sources.course = 'stated' }
    else if (course.name) {
      d.course_name = course.name; d.sources.course = 'stated'
      d.creates.courses.push(course.name)
    } else if (pattern?.course_id) {
      d.course_id = pattern.course_id; d.sources.course = 'pattern'
    }

    if (group.id) { d.group_id = group.id; d.sources.group = 'stated' }
    else if (group.name) {
      d.group_name = group.name; d.sources.group = 'stated'
      d.creates.groups.push(group.name)
    } else if (pattern?.group_id) {
      d.group_id = pattern.group_id; d.sources.group = 'pattern'
    }

    const conflict = findConflict(pool, d.date, d.start_time, d.end_time)
    if (conflict) d.conflict = conflict

    res.drafts.push(d)
  }

  // ---- 提醒 --------------------------------------------------------------
  const days = new Set(res.drafts.map((d) => d.date)).size
  res.warnings.push(`從貼上的內容讀出 ${res.drafts.length} 個時段，橫跨 ${days} 天。請核對後再加入。`)

  if (orphanTimes.length) {
    res.warnings.push(`這幾行找不到對應的日期，已略過：${orphanTimes.join('、')}`)
  }
  const noEnd = res.drafts.filter((d) => !d.end_time).length
  if (noEnd) res.warnings.push(`有 ${noEnd} 筆沒有結束時間，用預設時長補上。`)

  const allSub = res.drafts.every((d) => d.is_substitute)
  if (!allSub) {
    const noCourse = res.drafts.filter((d) => !d.course_id && !d.course_name).length
    if (noCourse) res.warnings.push(`有 ${noCourse} 筆還沒指定課程，可以先加入之後再補。`)
  }
  const conflicts = res.drafts.filter((d) => d.conflict).length
  if (conflicts) res.warnings.push(`有 ${conflicts} 筆和既有課程時段重疊，請確認。`)

  res.confidence = 0.85
  return res
}

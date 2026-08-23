import {
  allLessons, create, ensureCourse, ensureGroup, ensureLocation, findPrevTopic,
  learnPattern, patternExistsFor, update,
} from '../db/repo'
import { db } from '../db/local'
import type { Lesson } from '../db/types'
import type { LessonDraft, ParseResult } from './types'
import { timeToMin, weekdayOf } from '../lib/date'

export interface ApplyOptions {
  /** 建立課程後，若該時段還沒有固定課表，自動學起來 */
  learnPatterns?: boolean
  /** 使用者說的「上次上的是…」要不要回填到前一堂課 */
  backfillPrevTopic?: boolean
}

export interface ApplyReport {
  created: Lesson[]
  cancelled: Lesson[]
  rescheduled: Lesson[]
  backfilled: { lesson: Lesson; topic: string }[]
  learnedPatterns: number
  messages: string[]
}

export async function applyResult(
  res: ParseResult, opts: ApplyOptions = {},
): Promise<ApplyReport> {
  const report: ApplyReport = {
    created: [], cancelled: [], rescheduled: [], backfilled: [],
    learnedPatterns: 0, messages: [],
  }

  // ---- 停課 --------------------------------------------------------------
  for (const c of res.cancels) {
    const u = await update<Lesson>('lessons', c.lesson.id, { status: 'cancelled' })
    if (u) report.cancelled.push(u)
  }

  // ---- 改期 --------------------------------------------------------------
  for (const r of res.reschedules) {
    const patch: Partial<Lesson> = {}
    if (r.date) patch.date = r.date
    if (r.start_time) patch.start_time = r.start_time
    if (r.end_time) patch.end_time = r.end_time
    else if (r.start_time && !r.end_time) {
      const dur = timeToMin(r.lesson.end_time) - timeToMin(r.lesson.start_time)
      const t = timeToMin(r.start_time) + dur
      patch.end_time = `${String(Math.floor(t / 60) % 24).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`
    }
    const u = await update<Lesson>('lessons', r.lesson.id, patch)
    if (u) report.rescheduled.push(u)
  }

  // ---- 新增 --------------------------------------------------------------
  if (res.drafts.length) {
    // 同一批草稿裡重複出現的新實體只建立一次
    const locCache = new Map<string, string>()
    const couCache = new Map<string, string>()
    const grpCache = new Map<string, string>()

    for (const d of res.drafts) {
      const lesson = await draftToLesson(d, { locCache, couCache, grpCache })
      report.created.push(lesson)
    }

    if (opts.backfillPrevTopic !== false) {
      await backfillPrevTopics(report)
    }

    if (opts.learnPatterns) {
      const seen = new Set<string>()
      for (const l of report.created) {
        const key = `${weekdayOf(l.date)}|${l.start_time}|${l.group_id}`
        if (seen.has(key)) continue
        seen.add(key)
        const p = await learnPattern(l)
        if (p) report.learnedPatterns++
      }
    }
  }

  return report
}

async function draftToLesson(
  d: LessonDraft,
  caches: { locCache: Map<string, string>; couCache: Map<string, string>; grpCache: Map<string, string> },
): Promise<Lesson> {
  let location_id = d.location_id
  if (!location_id && d.location_name) {
    location_id = caches.locCache.get(d.location_name)
    if (!location_id) {
      location_id = (await ensureLocation(d.location_name)).id
      caches.locCache.set(d.location_name, location_id)
    }
  }
  let course_id = d.course_id
  if (!course_id && d.course_name) {
    course_id = caches.couCache.get(d.course_name)
    if (!course_id) {
      course_id = (await ensureCourse(d.course_name)).id
      caches.couCache.set(d.course_name, course_id)
    }
  }
  let group_id = d.group_id
  if (!group_id && d.group_name) {
    group_id = caches.grpCache.get(d.group_name)
    if (!group_id) {
      group_id = (await ensureGroup(d.group_name)).id
      caches.grpCache.set(d.group_name, group_id)
    }
  }

  return create<Lesson>('lessons', {
    kind: d.kind ?? 'class',
    title: d.title,
    guest_students: d.guest_students ?? [],
    headcount: d.headcount,
    date: d.date,
    start_time: d.start_time,
    end_time: d.end_time,
    location_id,
    course_id,
    group_id,
    is_substitute: d.is_substitute,
    substitute_for: d.substitute_for,
    topic: d.topic,
    prev_topic_manual: d.prev_topic_manual,
    note: d.note,
    status: 'planned',
    attendance: {},
    pattern_id: d.pattern_id,
  })
}

/**
 * 使用者說「上次上的是狗狗圍欄」時：
 * 如果同班級真的有前一堂課而且內容還空著，就把它補上去，
 * 這樣歷史紀錄才會連貫；補成功後就把新課上的手動註記清掉。
 */
async function backfillPrevTopics(report: ApplyReport): Promise<void> {
  const pool = await allLessons()
  for (const l of report.created) {
    const manual = l.prev_topic_manual?.trim()
    if (!manual || !l.group_id) continue
    const earlier = pool
      .filter(
        (x) =>
          x.id !== l.id && x.group_id === l.group_id && x.status !== 'cancelled' &&
          (x.date < l.date || (x.date === l.date && timeToMin(x.start_time) < timeToMin(l.start_time))),
      )
      .sort((a, b) => b.date.localeCompare(a.date) || timeToMin(b.start_time) - timeToMin(a.start_time))[0]
    if (earlier && !earlier.topic?.trim()) {
      const u = await update<Lesson>('lessons', earlier.id, { topic: manual })
      if (u) {
        report.backfilled.push({ lesson: u, topic: manual })
        await update<Lesson>('lessons', l.id, { prev_topic_manual: undefined })
        report.messages.push(
          `順便把 ${earlier.date} 那堂課的內容補成「${manual}」。`,
        )
      }
    }
  }
}

/** 建立課程後，詢問是否要記成固定課表用的判斷 */
export async function suggestPatternLearning(lessons: Lesson[]): Promise<Lesson[]> {
  const patterns = (await db.patterns.toArray()).filter((p) => !p.deleted)
  const out: Lesson[] = []
  const seen = new Set<string>()
  for (const l of lessons) {
    if (!l.group_id) continue
    const key = `${weekdayOf(l.date)}|${l.start_time}|${l.group_id}`
    if (seen.has(key)) continue
    seen.add(key)
    if (!patternExistsFor(patterns, l)) out.push(l)
  }
  return out
}

export { findPrevTopic }

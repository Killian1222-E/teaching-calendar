import { db, newId, nowISO } from './local'
import type {
  Base, Course, Group, ID, Lesson, Location, Pattern, Student, TableName,
} from './types'
import { timeToMin, weekdayOf } from '../lib/date'

// ---------------------------------------------------------------------------
// 泛用寫入
// ---------------------------------------------------------------------------

type WithoutBase<T> = Omit<T, 'id' | 'updated_at' | 'deleted' | 'dirty'> &
  Partial<Pick<Base, 'id'>>

function stamp<T extends Base>(rec: Omit<T, 'updated_at' | 'deleted' | 'dirty'>): T {
  return { ...rec, updated_at: nowISO(), deleted: 0, dirty: 1 } as T
}

export async function create<T extends Base>(table: TableName, data: WithoutBase<T>): Promise<T> {
  const rec = stamp<T>({ id: newId(), ...data } as Omit<T, 'updated_at' | 'deleted' | 'dirty'>)
  await (db as any)[table].put(rec)
  return rec
}

export async function update<T extends Base>(
  table: TableName, id: ID, patch: Partial<T>,
): Promise<T | undefined> {
  const cur = await (db as any)[table].get(id)
  if (!cur) return undefined
  const next = { ...cur, ...patch, id, updated_at: nowISO(), dirty: 1 as const }
  await (db as any)[table].put(next)
  return next
}

/** 軟刪除：保留列並標記 deleted=1，這樣刪除才能同步到其他裝置 */
export async function remove(table: TableName, id: ID): Promise<void> {
  const cur = await (db as any)[table].get(id)
  if (!cur) return
  await (db as any)[table].put({ ...cur, deleted: 1, updated_at: nowISO(), dirty: 1 })
}

const live = <T extends Base>(rows: T[]) => rows.filter((r) => !r.deleted)

// ---------------------------------------------------------------------------
// 讀取
// ---------------------------------------------------------------------------

export async function allLocations(): Promise<Location[]> {
  return live(await db.locations.toArray()).sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'))
}
export async function allCourses(): Promise<Course[]> {
  return live(await db.courses.toArray()).sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'))
}
export async function allGroups(): Promise<Group[]> {
  return live(await db.groups.toArray()).sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'))
}
export async function allPatterns(): Promise<Pattern[]> {
  return live(await db.patterns.toArray()).sort(
    (a, b) => a.weekday - b.weekday || timeToMin(a.start_time) - timeToMin(b.start_time),
  )
}
export async function studentsOf(groupId: ID): Promise<Student[]> {
  const rows = await db.students.where('group_id').equals(groupId).toArray()
  return live(rows).sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'))
}
export async function allStudents(): Promise<Student[]> {
  return live(await db.students.toArray())
}

export async function lessonsBetween(from: string, to: string): Promise<Lesson[]> {
  const rows = await db.lessons.where('date').between(from, to, true, true).toArray()
  return sortLessons(live(rows))
}

export async function allLessons(): Promise<Lesson[]> {
  return sortLessons(live(await db.lessons.toArray()))
}

export function sortLessons(rows: Lesson[]): Lesson[] {
  return rows.sort(
    (a, b) => a.date.localeCompare(b.date) || timeToMin(a.start_time) - timeToMin(b.start_time),
  )
}

// ---------------------------------------------------------------------------
// 「上次上的是什麼」
// ---------------------------------------------------------------------------

export interface PrevLessonInfo {
  topic: string
  date?: string
  source: 'history' | 'manual'
  /** 那一堂上的是哪一門課 */
  course_id?: ID
  /** 是否與目前這堂是同一門課 */
  sameCourse: boolean
}

export interface ProgressInfo {
  /** 同一門課上次上到哪（同一個班級） */
  sameCourse: PrevLessonInfo | null
  /** 這個班級上一次見面上了什麼（不分課程） */
  lastMeeting: PrevLessonInfo | null
}

type LessonLike = Pick<
  Lesson, 'id' | 'date' | 'start_time' | 'group_id' | 'course_id' | 'prev_topic_manual'
>

function earlierThan(a: { date: string; start_time: string }, b: LessonLike): boolean {
  return a.date < b.date || (a.date === b.date && timeToMin(a.start_time) < timeToMin(b.start_time))
}

function sortDesc(rows: Lesson[]): Lesson[] {
  return rows.sort(
    (a, b) => b.date.localeCompare(a.date) || timeToMin(b.start_time) - timeToMin(a.start_time),
  )
}

/**
 * 同一個班級每週上的課不一定一樣（這週 Minecraft、下週 Scratch），
 * 所以「上次上到哪」要分兩條線看：
 *   sameCourse  → 同一門課的進度，接著上很重要
 *   lastMeeting → 上一次見面做了什麼，用來記得班級狀況
 */
export function progressFor(lesson: LessonLike, pool: Lesson[]): ProgressInfo {
  const out: ProgressInfo = { sameCourse: null, lastMeeting: null }

  if (lesson.prev_topic_manual?.trim()) {
    out.sameCourse = {
      topic: lesson.prev_topic_manual.trim(),
      source: 'manual',
      sameCourse: true,
      course_id: lesson.course_id,
    }
  }
  if (!lesson.group_id) return out

  const candidates = sortDesc(
    pool.filter(
      (l) =>
        !l.deleted && l.id !== lesson.id && l.group_id === lesson.group_id &&
        l.status !== 'cancelled' && !!l.topic?.trim() && earlierThan(l, lesson),
    ),
  )

  const last = candidates[0]
  if (last) {
    out.lastMeeting = {
      topic: last.topic!.trim(),
      date: last.date,
      source: 'history',
      course_id: last.course_id,
      sameCourse: !!lesson.course_id && last.course_id === lesson.course_id,
    }
  }

  if (!out.sameCourse && lesson.course_id) {
    const sc = candidates.find((l) => l.course_id === lesson.course_id)
    if (sc) {
      out.sameCourse = {
        topic: sc.topic!.trim(), date: sc.date, source: 'history',
        course_id: sc.course_id, sameCourse: true,
      }
    }
  }
  return out
}

/**
 * 單一「上次上到」— 有指定課程時優先接同一門課的進度，
 * 否則就用上一次見面的內容。
 */
export function findPrevTopic(lesson: LessonLike, pool: Lesson[]): PrevLessonInfo | null {
  const p = progressFor(lesson, pool)
  return p.sameCourse ?? p.lastMeeting
}

/** 某班級最近一次有內容的課（不限定要在哪堂課之前） */
export function latestTopicOfGroup(groupId: ID, pool: Lesson[]): PrevLessonInfo | null {
  const rows = sortDesc(
    pool.filter(
      (l) => !l.deleted && l.group_id === groupId && l.status !== 'cancelled' && !!l.topic?.trim(),
    ),
  )
  const p = rows[0]
  return p
    ? { topic: p.topic!.trim(), date: p.date, source: 'history', course_id: p.course_id, sameCourse: false }
    : null
}

/** 某班級最近 n 堂有紀錄的課，用來看課程輪替與進度 */
export function recentHistory(groupId: ID, pool: Lesson[], n = 6): Lesson[] {
  return sortDesc(
    pool.filter((l) => !l.deleted && l.group_id === groupId && l.status !== 'cancelled'),
  ).slice(0, n)
}

/** 這個班級上過哪些課程（依最近使用排序），助理與 UI 用來提示課程會輪替 */
export function coursesUsedByGroup(groupId: ID, pool: Lesson[]): ID[] {
  const seen: ID[] = []
  for (const l of sortDesc(pool.filter((x) => !x.deleted && x.group_id === groupId))) {
    if (l.course_id && !seen.includes(l.course_id)) seen.push(l.course_id)
  }
  return seen
}

// ---------------------------------------------------------------------------
// 固定課表推斷
// ---------------------------------------------------------------------------

/**
 * 依「星期幾 + 時間」找出最合適的固定課表。
 * 時間完全吻合最優先；否則取重疊時間最長、且重疊超過一半的那筆。
 */
export function matchPattern(
  patterns: Pattern[],
  date: string,
  startTime?: string,
  endTime?: string,
  hints: { locationId?: ID; courseId?: ID } = {},
): Pattern | null {
  const wd = weekdayOf(date)
  let cands = patterns.filter((p) => !p.deleted && p.active && p.weekday === wd)
  cands = cands.filter(
    (p) => (!p.valid_from || date >= p.valid_from) && (!p.valid_to || date <= p.valid_to),
  )
  if (hints.locationId) {
    const f = cands.filter((p) => !p.location_id || p.location_id === hints.locationId)
    if (f.length) cands = f
  }
  if (hints.courseId) {
    const f = cands.filter((p) => !p.course_id || p.course_id === hints.courseId)
    if (f.length) cands = f
  }
  if (!cands.length) return null
  if (!startTime) return cands.length === 1 ? cands[0] : null

  const exact = cands.find(
    (p) => p.start_time === startTime && (!endTime || p.end_time === endTime),
  )
  if (exact) return exact

  const s = timeToMin(startTime)
  const e = endTime ? timeToMin(endTime) : s + 90
  let best: { p: Pattern; ov: number } | null = null
  for (const p of cands) {
    const ps = timeToMin(p.start_time)
    const pe = timeToMin(p.end_time)
    const ov = Math.min(e, pe) - Math.max(s, ps)
    const span = Math.min(e - s, pe - ps)
    if (ov > 0 && ov >= span * 0.5 && (!best || ov > best.ov)) best = { p, ov }
  }
  return best?.p ?? null
}

/** 這堂課是否已經有對應的固定課表？沒有的話 UI 會詢問要不要建立 */
export function patternExistsFor(patterns: Pattern[], lesson: Lesson): boolean {
  const wd = weekdayOf(lesson.date)
  return patterns.some(
    (p) =>
      !p.deleted && p.active && p.weekday === wd &&
      p.start_time === lesson.start_time &&
      p.group_id === lesson.group_id,
  )
}

export async function learnPattern(lesson: Lesson): Promise<Pattern | null> {
  if (!lesson.group_id) return null
  const existing = await allPatterns()
  if (patternExistsFor(existing, lesson)) return null
  return create<Pattern>('patterns', {
    weekday: weekdayOf(lesson.date),
    start_time: lesson.start_time,
    end_time: lesson.end_time,
    location_id: lesson.location_id,
    course_id: lesson.course_id,
    group_id: lesson.group_id,
    active: 1,
    valid_from: lesson.date,
  })
}

// ---------------------------------------------------------------------------
// 名稱模糊比對 / 自動建立
// ---------------------------------------------------------------------------

export function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .replace(/[\s　]/g, '')
    .replace(/[（）()【】\[\]「」『』,，、。.:：;；!！?？_\-–—/\\]/g, '')
}

export interface NamedRec extends Base { name: string; aliases?: string[] }

/** 回傳 [紀錄, 信心度 0~1]。完全相同=1，別名=0.95，包含關係依長度比例遞減 */
export function fuzzyFind<T extends NamedRec>(
  rows: T[], query: string,
): { rec: T; score: number } | null {
  const q = normalizeName(query)
  if (!q) return null
  let best: { rec: T; score: number } | null = null
  for (const r of rows) {
    if (r.deleted) continue
    const cands = [r.name, ...(r.aliases ?? [])]
    for (const c of cands) {
      const n = normalizeName(c)
      if (!n) continue
      let score = 0
      if (n === q) score = c === r.name ? 1 : 0.95
      else if (n.includes(q)) score = 0.6 + 0.3 * (q.length / n.length)
      else if (q.includes(n)) score = 0.6 + 0.3 * (n.length / q.length)
      if (score > (best?.score ?? 0)) best = { rec: r, score }
    }
  }
  return best && best.score >= 0.6 ? best : null
}

const PALETTE = [
  '#6c8cff', '#38bdf8', '#34d399', '#fbbf24',
  '#f472b6', '#a78bfa', '#fb7185', '#2dd4bf',
]

export function pickColor(seed: number): string {
  return PALETTE[seed % PALETTE.length]
}

export async function ensureLocation(name: string): Promise<Location> {
  const rows = await allLocations()
  const hit = fuzzyFind(rows, name)
  if (hit) return hit.rec
  return create<Location>('locations', { name: name.trim(), color: pickColor(rows.length) })
}

export async function ensureCourse(name: string): Promise<Course> {
  const rows = await allCourses()
  const hit = fuzzyFind(rows, name)
  if (hit) return hit.rec
  return create<Course>('courses', {
    name: name.trim(), aliases: [], color: pickColor(rows.length + 3),
  })
}

export async function ensureGroup(name: string): Promise<Group> {
  const rows = await allGroups()
  const hit = fuzzyFind(rows, name)
  if (hit) return hit.rec
  return create<Group>('groups', { name: name.trim(), aliases: [] })
}

// ---------------------------------------------------------------------------
// 重複排課
// ---------------------------------------------------------------------------

export interface RecurringSpec {
  weekdays: number[]
  from: string
  to: string
  /** 每 n 週一次 */
  interval?: number
  skip?: string[]
}

export function expandRecurring(spec: RecurringSpec): string[] {
  const out: string[] = []
  const interval = Math.max(1, spec.interval ?? 1)
  const skip = new Set(spec.skip ?? [])
  const start = new Date(spec.from + 'T00:00:00')
  const end = new Date(spec.to + 'T00:00:00')
  if (end < start) return out
  let weekIdx = 0
  let cursor = new Date(start)
  // 對齊到該週週一，方便算「每 n 週」
  const back = cursor.getDay() === 0 ? 6 : cursor.getDay() - 1
  cursor.setDate(cursor.getDate() - back)
  while (cursor <= end) {
    if (weekIdx % interval === 0) {
      for (let i = 0; i < 7; i++) {
        const d = new Date(cursor)
        d.setDate(d.getDate() + i)
        if (d < start || d > end) continue
        if (!spec.weekdays.includes(d.getDay())) continue
        const s = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
        if (!skip.has(s)) out.push(s)
      }
    }
    cursor.setDate(cursor.getDate() + 7)
    weekIdx++
  }
  return out.sort()
}

/** 同一天同一時段是否已經有課（避免重複匯入） */
export function findConflict(
  lessons: Lesson[], date: string, start: string, end: string, ignoreId?: ID,
): Lesson | null {
  const s = timeToMin(start)
  const e = timeToMin(end)
  return (
    lessons.find(
      (l) =>
        !l.deleted && l.id !== ignoreId && l.date === date && l.status !== 'cancelled' &&
        timeToMin(l.start_time) < e && timeToMin(l.end_time) > s,
    ) ?? null
  )
}

import type { Lesson, Student } from '../db/types'

export interface RosterInfo {
  /** 這堂課的學生人數 */
  count: number
  /** 有名字的話列在這裡（大活動通常只有人數沒有名字） */
  names: string[]
  source: 'group' | 'guest' | 'headcount' | 'none'
}

/**
 * 算出一堂課「有幾位學生」。
 * 常態課 → 該班級的名單人數
 * 代課 / 大活動 → 這堂課自己記的臨時名單，或直接填的人數
 * 手動填的 headcount 一律優先，因為那是老師當下數出來的。
 */
export function rosterOf(
  lesson: Pick<Lesson, 'kind' | 'group_id' | 'is_substitute' | 'guest_students' | 'headcount'>,
  studentsOfGroup: (groupId?: string) => Student[],
): RosterInfo {
  const guests = (lesson.guest_students ?? []).filter((n) => n.trim())
  const hc = lesson.headcount

  if (lesson.kind === 'event') {
    if (hc && hc > 0) return { count: hc, names: guests, source: 'headcount' }
    if (guests.length) return { count: guests.length, names: guests, source: 'guest' }
    return { count: 0, names: [], source: 'none' }
  }

  if (lesson.is_substitute && !lesson.group_id) {
    if (hc && hc > 0) return { count: hc, names: guests, source: 'headcount' }
    if (guests.length) return { count: guests.length, names: guests, source: 'guest' }
    return { count: 0, names: [], source: 'none' }
  }

  if (guests.length || (hc && hc > 0)) {
    // 代課但仍掛在某個班級底下時，臨時名單優先
    if (lesson.is_substitute) {
      return { count: hc && hc > 0 ? hc : guests.length, names: guests, source: hc ? 'headcount' : 'guest' }
    }
  }

  if (lesson.group_id) {
    const kids = studentsOfGroup(lesson.group_id)
    if (hc && hc > 0) return { count: hc, names: kids.map((s) => s.name), source: 'headcount' }
    return { count: kids.length, names: kids.map((s) => s.name), source: 'group' }
  }

  if (hc && hc > 0) return { count: hc, names: guests, source: 'headcount' }
  return { count: 0, names: [], source: 'none' }
}

/** 大活動人數級距，UI 用來標示規模 */
export function eventScale(count: number): { label: string; tone: 'ok' | 'warn' | 'danger' } {
  if (count >= 50) return { label: '大場', tone: 'danger' }
  if (count >= 20) return { label: '中場', tone: 'warn' }
  return { label: '小場', tone: 'ok' }
}

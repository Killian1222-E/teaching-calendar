import { describe, expect, it } from 'vitest'
import { parse } from './parse'
import type { ParseContext } from './types'
import type { Course, Group, Lesson, Location, Pattern } from '../db/types'

const base = { updated_at: '2026-01-01T00:00:00.000Z', deleted: 0 as const, dirty: 0 as const }

const loc = (id: string, name: string): Location => ({ ...base, id, name, color: '#fff' })
const cou = (id: string, name: string, aliases: string[] = []): Course =>
  ({ ...base, id, name, aliases, color: '#fff' })
const grp = (id: string, name: string, aliases: string[] = []): Group =>
  ({ ...base, id, name, aliases })
const pat = (o: Partial<Pattern> & { id: string; weekday: number; start_time: string; end_time: string }): Pattern =>
  ({ ...base, active: 1, ...o } as Pattern)
const les = (o: Partial<Lesson> & { id: string; date: string; start_time: string; end_time: string }): Lesson =>
  ({ ...base, kind: 'class', is_substitute: 0, guest_students: [], status: 'planned', attendance: {}, ...o } as Lesson)

function ctxOf(over: Partial<ParseContext> = {}): ParseContext {
  return {
    today: '2026-08-23', // 星期日
    defaultMinutes: 90,
    locations: [loc('L1', '三民分校'), loc('L2', '左營分校')],
    courses: [cou('C1', 'Minecraft 教育版', ['Minecraft', 'MC', '麥塊']), cou('C2', '樂高教育', ['樂高', 'LEGO'])],
    groups: [grp('G1', '學生組A'), grp('G2', '學生組B')],
    patterns: [],
    lessons: [],
    ...over,
  }
}

describe('使用者原始例句', () => {
  const input = '8/25 1300-1430 三民分校 Minecraft 學生組B、 不是代課，上次Minecraft 狗狗圍欄'

  it('完整拆解出所有欄位', () => {
    const r = parse(input, ctxOf())
    expect(r.intent).toBe('create')
    expect(r.drafts).toHaveLength(1)
    const d = r.drafts[0]
    expect(d.date).toBe('2026-08-25')
    expect(d.start_time).toBe('13:00')
    expect(d.end_time).toBe('14:30')
    expect(d.location_id).toBe('L1')
    expect(d.course_id).toBe('C1')
    expect(d.group_id).toBe('G2')
    expect(d.is_substitute).toBe(0)
    expect(d.sources.substitute).toBe('stated')
    expect(d.prev_topic_manual).toBe('狗狗圍欄')
    expect(r.confidence).toBeGreaterThan(0.7)
    expect(r.needsAI).toBe(false)
  })

  it('資料庫全空時，也能認出要新建哪些項目', () => {
    const empty = ctxOf({ locations: [], courses: [], groups: [] })
    const r = parse(input, empty)
    const d = r.drafts[0]
    expect(d.location_name).toBe('三民分校')
    expect(d.course_name).toBe('Minecraft 教育版')
    expect(d.group_name).toBe('學生組B')
    expect(d.creates.locations).toContain('三民分校')
    expect(d.creates.groups).toContain('學生組B')
  })
})

describe('固定課表推斷', () => {
  const patterns = [
    pat({ id: 'P1', weekday: 1, start_time: '14:00', end_time: '15:30', group_id: 'G2', course_id: 'C2', location_id: 'L1' }),
    pat({ id: 'P2', weekday: 3, start_time: '16:00', end_time: '17:30', group_id: 'G1', course_id: 'C1', location_id: 'L2' }),
  ]

  it('沒講班級時，用星期＋時間推斷出班級、地點、課程', () => {
    const r = parse('8/31 1400-1530 有課', ctxOf({ patterns }))
    const d = r.drafts[0]
    expect(d.date).toBe('2026-08-31') // 週一
    expect(d.group_id).toBe('G2')
    expect(d.sources.group).toBe('pattern')
    expect(d.course_id).toBe('C2')
    expect(d.location_id).toBe('L1')
  })

  it('只給日期也能推斷（該星期只有一筆固定課表）', () => {
    const r = parse('9/2 的課', ctxOf({ patterns }))
    const d = r.drafts[0]
    expect(d.date).toBe('2026-09-02') // 週三
    expect(d.start_time).toBe('16:00')
    expect(d.end_time).toBe('17:30')
    expect(d.group_id).toBe('G1')
    expect(d.sources.time).toBe('pattern')
  })

  it('使用者明講的班級優先於固定課表', () => {
    const r = parse('8/31 1400-1530 學生組A', ctxOf({ patterns }))
    expect(r.drafts[0].group_id).toBe('G1')
    expect(r.drafts[0].sources.group).toBe('stated')
  })
})

describe('日期與時間寫法', () => {
  it('明天下午2點到3點半', () => {
    const r = parse('明天下午2點到3點半 樂高 代課', ctxOf())
    const d = r.drafts[0]
    expect(d.date).toBe('2026-08-24')
    expect(d.start_time).toBe('14:00')
    expect(d.end_time).toBe('15:30')
    expect(d.is_substitute).toBe(1)
    expect(d.course_id).toBe('C2')
  })

  // 今天是 8/23 (週日)，本週為 8/17~8/23，所以「下週三」= 8/26
  it('下週三 13:00~14:30', () => {
    const r = parse('下週三 13:00~14:30 左營分校 MC 學生組A', ctxOf())
    const d = r.drafts[0]
    expect(d.date).toBe('2026-08-26')
    expect(d.start_time).toBe('13:00')
    expect(d.location_id).toBe('L2')
    expect(d.course_id).toBe('C1')
  })

  it('只給開始時間時，用預設時長補結束時間', () => {
    const r = parse('8/26 1500 三民分校 樂高 學生組B', ctxOf())
    expect(r.drafts[0].start_time).toBe('15:00')
    expect(r.drafts[0].end_time).toBe('16:30')
  })

  it('指定時長', () => {
    const r = parse('8/26 15:00 60分鐘 樂高 學生組B', ctxOf())
    expect(r.drafts[0].end_time).toBe('16:00')
  })

  it('中文數字日期', () => {
    const r = parse('九月十五日 下午三點 樂高 學生組B', ctxOf())
    expect(r.drafts[0].date).toBe('2026-09-15')
    expect(r.drafts[0].start_time).toBe('15:00')
  })

  it('多個日期一次排', () => {
    const r = parse('8/25、8/27 1300-1430 三民分校 樂高 學生組B', ctxOf())
    expect(r.drafts.map((d) => d.date)).toEqual(['2026-08-25', '2026-08-27'])
  })
})

describe('重複排課', () => {
  it('9月每週一', () => {
    const r = parse('9月每週一 1400-1530 三民分校 樂高 學生組B', ctxOf())
    expect(r.drafts.map((d) => d.date)).toEqual([
      '2026-09-07', '2026-09-14', '2026-09-21', '2026-09-28',
    ])
    expect(r.drafts[0].start_time).toBe('14:00')
  })

  it('每週二、四，連續 3 週', () => {
    const r = parse('每週二、四 1600-1730 左營分校 MC 學生組A 連續3週', ctxOf())
    expect(r.drafts.length).toBe(6)
    expect(r.drafts[0].date).toBe('2026-08-25')
  })

  it('9/1到9/15 每週三', () => {
    const r = parse('9/1到9/15 每週三 1400-1530 樂高 學生組B', ctxOf())
    expect(r.drafts.map((d) => d.date)).toEqual(['2026-09-02', '2026-09-09'])
  })
})

describe('停課與改期', () => {
  const lessons = [
    les({ id: 'X1', date: '2026-09-07', start_time: '14:00', end_time: '15:30', group_id: 'G2', course_id: 'C2', location_id: 'L1' }),
    les({ id: 'X2', date: '2026-09-09', start_time: '16:00', end_time: '17:30', group_id: 'G1' }),
  ]

  it('停課', () => {
    const r = parse('9/7 停課', ctxOf({ lessons }))
    expect(r.intent).toBe('cancel')
    expect(r.cancels.map((c) => c.lesson.id)).toEqual(['X1'])
  })

  it('請假只影響指定班級', () => {
    const r = parse('9/7 學生組A 請假', ctxOf({ lessons }))
    expect(r.intent).toBe('cancel')
    expect(r.cancels).toHaveLength(0)
  })

  it('改期到別天', () => {
    const r = parse('9/7 的課改到 9/14', ctxOf({ lessons }))
    expect(r.intent).toBe('reschedule')
    expect(r.reschedules[0].lesson.id).toBe('X1')
    expect(r.reschedules[0].date).toBe('2026-09-14')
  })
})

describe('查詢', () => {
  const lessons = [
    les({ id: 'X1', date: '2026-08-17', start_time: '14:00', end_time: '15:30', group_id: 'G2', course_id: 'C1', topic: '狗狗圍欄' }),
    les({ id: 'X2', date: '2026-08-24', start_time: '14:00', end_time: '15:30', group_id: 'G2', course_id: 'C1' }),
  ]

  it('某班上次上什麼', () => {
    const r = parse('學生組B上次上什麼？', ctxOf({ lessons }))
    expect(r.intent).toBe('query')
    expect(r.answer).toContain('狗狗圍欄')
  })

  it('列出近期課程', () => {
    const r = parse('這個月有哪些課', ctxOf({ lessons }))
    expect(r.intent).toBe('query')
    expect(r.answer).toContain('8月24日')
  })
})

describe('上次進度的自動接續', () => {
  it('新課會顯示同班級前一堂的內容', async () => {
    const { findPrevTopic } = await import('../db/repo')
    const pool = [
      les({ id: 'X1', date: '2026-08-17', start_time: '14:00', end_time: '15:30', group_id: 'G2', course_id: 'C1', topic: '狗狗圍欄' }),
    ]
    const next = les({ id: 'X2', date: '2026-08-24', start_time: '14:00', end_time: '15:30', group_id: 'G2', course_id: 'C1' })
    expect(findPrevTopic(next, pool)?.topic).toBe('狗狗圍欄')
  })

  it('手動註記優先於歷史紀錄', () => {
    const r = parse('8/25 1300-1430 三民分校 MC 學生組B 上次是紅石電路', ctxOf())
    expect(r.drafts[0].prev_topic_manual).toBe('紅石電路')
  })
})

describe('信心不足時交給 AI', () => {
  it('讀不到日期就標記 needsAI', () => {
    const r = parse('幫我看看那個東西', ctxOf())
    expect(r.needsAI).toBe(true)
    expect(r.drafts).toHaveLength(0)
  })
})

// ===========================================================================
// 大活動
// ===========================================================================
describe('大活動', () => {
  it('中鋼那種 80 人的大場子', () => {
    const r = parse('9/20 0900-1600 中鋼大活動 80人 Minecraft', ctxOf())
    expect(r.intent).toBe('create')
    const d = r.drafts[0]
    expect(d.kind).toBe('event')
    expect(d.title).toBe('中鋼')
    expect(d.headcount).toBe(80)
    expect(d.start_time).toBe('09:00')
    expect(d.end_time).toBe('16:00')
    expect(d.course_id).toBe('C1')
    expect(d.group_id).toBeUndefined()
  })

  it('大活動不會被固定課表綁上班級', () => {
    const patterns = [
      pat({ id: 'P1', weekday: 1, start_time: '14:00', end_time: '15:30', group_id: 'G2', course_id: 'C2' }),
    ]
    const r = parse('8/31 1400-1530 科技體驗營 共 25 位小朋友', ctxOf({ patterns }))
    expect(r.drafts[0].kind).toBe('event')
    expect(r.drafts[0].group_id).toBeUndefined()
    expect(r.drafts[0].headcount).toBe(25)
  })

  it('中文數字人數', () => {
    const r = parse('10/5 上午9點 樂高 參訪 三十人', ctxOf())
    expect(r.drafts[0].kind).toBe('event')
    expect(r.drafts[0].headcount).toBe(30)
  })

  it('沒填人數會提醒', () => {
    const r = parse('9/20 0900-1600 中鋼大活動', ctxOf())
    expect(r.warnings.join()).toContain('人數')
  })

  it('地點名稱不會被誤當成活動名稱', () => {
    const r = parse('9/20 0900-1600 三民分校 活動 40人', ctxOf())
    expect(r.drafts[0].location_id).toBe('L1')
    expect(r.drafts[0].title).toBeUndefined()
  })
})

// ===========================================================================
// 同一班課程會輪替
// ===========================================================================
describe('課程輪替', () => {
  const lessons = [
    les({ id: 'A1', date: '2026-08-03', start_time: '14:00', end_time: '15:30', group_id: 'G2', course_id: 'C1', topic: '狗狗圍欄' }),
    les({ id: 'A2', date: '2026-08-10', start_time: '14:00', end_time: '15:30', group_id: 'G2', course_id: 'C2', topic: '齒輪組' }),
    les({ id: 'A3', date: '2026-08-17', start_time: '14:00', end_time: '15:30', group_id: 'G2', course_id: 'C1', topic: '紅石電路' }),
  ]

  it('沒指定課程時會提醒這班有輪替', () => {
    const patterns = [pat({ id: 'P1', weekday: 1, start_time: '14:00', end_time: '15:30', group_id: 'G2' })]
    const r = parse('8/31 1400-1530 有課', ctxOf({ lessons, patterns }))
    expect(r.drafts[0].group_id).toBe('G2')
    expect(r.warnings.join()).toMatch(/每週不一定一樣|指定/)
  })

  it('同一門課的進度會接續，不會被別門課蓋掉', async () => {
    const { progressFor } = await import('../db/repo')
    const next = les({ id: 'A4', date: '2026-08-24', start_time: '14:00', end_time: '15:30', group_id: 'G2', course_id: 'C2' })
    const p = progressFor(next, lessons)
    expect(p.sameCourse?.topic).toBe('齒輪組')      // 上次的樂高
    expect(p.lastMeeting?.topic).toBe('紅石電路')    // 上一次見面（Minecraft）
  })

  it('沒指定課程時就用上一次見面的內容', async () => {
    const { progressFor } = await import('../db/repo')
    const next = les({ id: 'A5', date: '2026-08-24', start_time: '14:00', end_time: '15:30', group_id: 'G2' })
    const p = progressFor(next, lessons)
    expect(p.sameCourse).toBeNull()
    expect(p.lastMeeting?.topic).toBe('紅石電路')
  })
})

// ===========================================================================
// 人數計算
// ===========================================================================
describe('人數計算', () => {
  const students = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      ...base, id: 's' + i, group_id: 'G2', name: '學生' + i, active: 1 as const,
    }))
  const sOf = (gid?: string) => (gid === 'G2' ? students(5) : [])

  it('常態課用班級名單人數', async () => {
    const { rosterOf } = await import('../lib/roster')
    const l = les({ id: 'X', date: '2026-09-01', start_time: '14:00', end_time: '15:30', group_id: 'G2' })
    expect(rosterOf(l, sOf as any)).toMatchObject({ count: 5, source: 'group' })
  })

  it('代課用這堂課自己的臨時名單', async () => {
    const { rosterOf } = await import('../lib/roster')
    const l = les({
      id: 'X', date: '2026-09-01', start_time: '14:00', end_time: '15:30',
      is_substitute: 1, guest_students: ['小明', '小華', '阿哲'],
    })
    expect(rosterOf(l, sOf as any)).toMatchObject({ count: 3, source: 'guest' })
  })

  it('只填人數也算得出來', async () => {
    const { rosterOf } = await import('../lib/roster')
    const l = les({
      id: 'X', kind: 'event', date: '2026-09-01', start_time: '09:00', end_time: '16:00',
      headcount: 80, guest_students: [],
    })
    expect(rosterOf(l, sOf as any)).toMatchObject({ count: 80, source: 'headcount' })
  })

  it('大活動人數級距', async () => {
    const { eventScale } = await import('../lib/roster')
    expect(eventScale(80).label).toBe('大場')
    expect(eventScale(25).label).toBe('中場')
    expect(eventScale(8).label).toBe('小場')
  })
})

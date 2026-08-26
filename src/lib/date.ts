// 全部用本地時區的 "YYYY-MM-DD" 字串當日期主鍵，避免 UTC 位移造成差一天。

export const WEEKDAY_ZH = ['日', '一', '二', '三', '四', '五', '六']

export function pad2(n: number): string {
  return n < 10 ? '0' + n : String(n)
}

export function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

export function fromDateStr(s: string): Date {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, (m ?? 1) - 1, d ?? 1)
}

export function todayStr(): string {
  return toDateStr(new Date())
}

export function addDays(s: string, n: number): string {
  const d = fromDateStr(s)
  d.setDate(d.getDate() + n)
  return toDateStr(d)
}

export function addMonths(s: string, n: number): string {
  const d = fromDateStr(s)
  const day = d.getDate()
  d.setDate(1)
  d.setMonth(d.getMonth() + n)
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
  d.setDate(Math.min(day, last))
  return toDateStr(d)
}

export function weekdayOf(s: string): number {
  return fromDateStr(s).getDay()
}

/** 該週的週一 */
export function startOfWeek(s: string): string {
  const wd = weekdayOf(s)
  const back = wd === 0 ? 6 : wd - 1
  return addDays(s, -back)
}

export function startOfMonth(s: string): string {
  const d = fromDateStr(s)
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-01`
}

export function endOfMonth(s: string): string {
  const d = fromDateStr(s)
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0)
  return toDateStr(last)
}

/** 月曆格線用：從該月第一天所在週的「週日」開始，共 6 週 42 天。
 *  週曆表頭是日一二三四五六（週日排第一欄），這裡一定要對齊表頭，
 *  之前誤用 startOfWeek()（回傳週一）起算，整排日期就會全部往前錯一欄。 */
export function monthGrid(anchor: string): string[] {
  const first = startOfMonth(anchor)
  let cur = addDays(first, -weekdayOf(first))
  const out: string[] = []
  for (let i = 0; i < 42; i++) {
    out.push(cur)
    cur = addDays(cur, 1)
  }
  return out
}

export function sameMonth(a: string, b: string): boolean {
  return a.slice(0, 7) === b.slice(0, 7)
}

/** "8/25" → "08月25日 (二)" */
export function formatDateZh(s: string, opts: { year?: boolean } = {}): string {
  const d = fromDateStr(s)
  const y = opts.year ? `${d.getFullYear()}年` : ''
  return `${y}${d.getMonth() + 1}月${d.getDate()}日 (${WEEKDAY_ZH[d.getDay()]})`
}

export function formatDateShort(s: string): string {
  const d = fromDateStr(s)
  return `${d.getMonth() + 1}/${d.getDate()}`
}

/** 分鐘數 ← "14:30" */
export function timeToMin(t: string): number {
  const [h, m] = t.split(':').map(Number)
  return (h ?? 0) * 60 + (m ?? 0)
}

export function minToTime(n: number): string {
  const x = ((n % 1440) + 1440) % 1440
  return `${pad2(Math.floor(x / 60))}:${pad2(x % 60)}`
}

export function addMinutes(time: string, minutes: number): string {
  const total = timeToMin(time) + minutes
  return `${pad2(Math.floor(total / 60) % 24)}:${pad2(((total % 60) + 60) % 60)}`
}

export function durationLabel(start: string, end: string): string {
  const mins = timeToMin(end) - timeToMin(start)
  if (mins <= 0) return ''
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return h ? (m ? `${h}小時${m}分` : `${h}小時`) : `${m}分`
}

/** 相對日期描述：今天 / 明天 / 3 天後 / 已過 2 天 */
export function relativeDayLabel(s: string, from = todayStr()): string {
  const diff = Math.round(
    (fromDateStr(s).getTime() - fromDateStr(from).getTime()) / 86400000,
  )
  if (diff === 0) return '今天'
  if (diff === 1) return '明天'
  if (diff === 2) return '後天'
  if (diff === -1) return '昨天'
  if (diff > 0) return `${diff} 天後`
  return `${-diff} 天前`
}

export function isPast(dateStr: string, endTime?: string): boolean {
  const now = new Date()
  const today = toDateStr(now)
  if (dateStr < today) return true
  if (dateStr > today) return false
  if (!endTime) return false
  return now.getHours() * 60 + now.getMinutes() > timeToMin(endTime)
}

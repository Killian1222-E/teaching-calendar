import { addDays, addMonths, endOfMonth, fromDateStr, pad2, startOfMonth, toDateStr, weekdayOf } from '../lib/date'
import type { Consumer } from './normalize'

// ---------------------------------------------------------------------------
// 時間
// ---------------------------------------------------------------------------

export interface TimeSpan {
  start?: string
  end?: string
  /** 有沒有明確的上午/下午標記 */
  explicitMeridiem: boolean
  /** 只講了時長（分鐘） */
  durationMin?: number
}

const MERIDIEM_PM = /^(下午|晚上|傍晚|午後|晚間|pm|PM)$/
const MERIDIEM_AM = /^(上午|早上|早晨|凌晨|清晨|am|AM)$/

function applyMeridiem(h: number, mer: string | undefined): { h: number; explicit: boolean } {
  if (mer) {
    if (MERIDIEM_PM.test(mer)) return { h: h === 12 ? 12 : h + 12, explicit: true }
    if (MERIDIEM_AM.test(mer)) return { h: h === 12 ? 0 : h, explicit: true }
    if (mer === '中午') return { h: h === 12 ? 12 : h + 12, explicit: true }
  }
  return { h, explicit: false }
}

/**
 * 沒有上午/下午標記時的推斷：
 * 兒童才藝課幾乎都在下午與晚上，1~7 點視為下午，8~11 點視為上午。
 */
function guessHour(h: number): number {
  if (h >= 1 && h <= 7) return h + 12
  return h
}

function mk(h: number, m: number): string {
  return `${pad2(Math.min(23, Math.max(0, h)))}:${pad2(Math.min(59, Math.max(0, m)))}`
}

const MER = '(上午|早上|早晨|凌晨|清晨|中午|下午|晚上|傍晚|午後|晚間|am|pm|AM|PM)'
const RANGE_SEP = '\\s*(?:~|-|至|到|–)\\s*'

export function parseTimes(text: string, consumer?: Consumer): TimeSpan {
  const out: TimeSpan = { explicitMeridiem: false }

  // 1) 13:00-14:30 / 13:00~14:30（可帶上下午前綴）
  let m = text.match(
    new RegExp(`${MER}?\\s*(\\d{1,2}):(\\d{2})${RANGE_SEP}${MER}?\\s*(\\d{1,2}):(\\d{2})`),
  )
  if (m) {
    const a = applyMeridiem(+m[2], m[1])
    const b = applyMeridiem(+m[5], m[4] ?? m[1])
    let sh = a.explicit ? a.h : +m[2]
    let eh = b.explicit ? b.h : +m[5]
    if (!a.explicit && !b.explicit) { sh = guessHour(sh); eh = guessHour(eh) }
    if (eh * 60 + +m[6] <= sh * 60 + +m[3]) eh += 12
    out.start = mk(sh, +m[3])
    out.end = mk(eh, +m[6])
    out.explicitMeridiem = a.explicit || b.explicit
    consumer?.consumeMatch(m)
    return out
  }

  // 2) 1300-1430（四位數軍用時間）
  m = text.match(new RegExp(`(?<![\\d:])(\\d{3,4})${RANGE_SEP}(\\d{3,4})(?![\\d:])`))
  if (m) {
    const p = (v: string) => {
      const n = parseInt(v, 10)
      return { h: Math.floor(n / 100), m: n % 100 }
    }
    const a = p(m[1]); const b = p(m[2])
    if (a.h <= 23 && a.m <= 59 && b.h <= 23 && b.m <= 59) {
      out.start = mk(a.h, a.m)
      out.end = mk(b.h, b.m)
      out.explicitMeridiem = true
      consumer?.consumeMatch(m)
      return out
    }
  }

  // 3) 下午1點30分到2點半 / 2點到3點
  m = text.match(
    new RegExp(`${MER}?\\s*(\\d{1,2})\\s*點\\s*(\\d{1,2})?\\s*分?${RANGE_SEP}${MER}?\\s*(\\d{1,2})\\s*點\\s*(\\d{1,2})?\\s*分?`),
  )
  if (m) {
    const a = applyMeridiem(+m[2], m[1])
    const b = applyMeridiem(+m[5], m[4] ?? m[1])
    let sh = a.explicit ? a.h : +m[2]
    let eh = b.explicit ? b.h : +m[5]
    if (!a.explicit && !b.explicit) { sh = guessHour(sh); eh = guessHour(eh) }
    const sm = m[3] ? +m[3] : 0
    const em = m[6] ? +m[6] : 0
    if (eh * 60 + em <= sh * 60 + sm) eh += 12
    out.start = mk(sh, sm)
    out.end = mk(eh, em)
    out.explicitMeridiem = a.explicit || b.explicit
    consumer?.consumeMatch(m)
    return out
  }

  // 4) 單一起始時間
  m = text.match(new RegExp(`${MER}?\\s*(\\d{1,2}):(\\d{2})`))
  if (m) {
    const a = applyMeridiem(+m[2], m[1])
    out.start = mk(a.explicit ? a.h : guessHour(+m[2]), +m[3])
    out.explicitMeridiem = a.explicit
    consumer?.consumeMatch(m)
  }
  if (!out.start) {
    m = text.match(new RegExp(`${MER}?\\s*(\\d{1,2})\\s*點\\s*(\\d{1,2})?\\s*分?`))
    if (m) {
      const a = applyMeridiem(+m[2], m[1])
      out.start = mk(a.explicit ? a.h : guessHour(+m[2]), m[3] ? +m[3] : 0)
      out.explicitMeridiem = a.explicit
      consumer?.consumeMatch(m)
    }
  }
  if (!out.start) {
    m = text.match(/(?<![\d:\/\-])(\d{4})(?![\d:\/\-])/)
    if (m) {
      const n = parseInt(m[1], 10)
      const h = Math.floor(n / 100); const mm = n % 100
      // 避開被當成年份的情況
      if (h <= 23 && mm <= 59 && n >= 600 && !(n >= 1900 && n <= 2100)) {
        out.start = mk(h, mm)
        out.explicitMeridiem = true
        consumer?.consumeMatch(m)
      }
    }
  }

  // 時長：90分鐘 / 1.5小時 / 一個半小時
  const dm = text.match(/(\d+(?:\.\d+)?)\s*(小時|鐘頭|hr|h)(?:\s*(\d+)\s*分)?|(\d+)\s*分鐘/)
  if (dm) {
    if (dm[4]) out.durationMin = +dm[4]
    else out.durationMin = Math.round(parseFloat(dm[1]) * 60) + (dm[3] ? +dm[3] : 0)
    consumer?.consumeMatch(dm)
  }
  const halfHour = text.match(/(\d+)\s*個?半\s*小時/)
  if (halfHour) {
    out.durationMin = +halfHour[1] * 60 + 30
    consumer?.consumeMatch(halfHour)
  }

  return out
}

// ---------------------------------------------------------------------------
// 日期
// ---------------------------------------------------------------------------

export interface DateResult {
  /** 明確列出的單一或多個日期 */
  dates: string[]
  /** 重複規則 */
  recurring?: {
    weekdays: number[]
    from: string
    to: string
    interval: number
  }
  /** 只給了範圍沒給星期（例如「9月」） */
  range?: { from: string; to: string }
  matched: boolean
}

const WD_CHAR: Record<string, number> = {
  日: 0, 天: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6,
}

/** M/D 沒給年份時，選離今天最近的合理年份 */
function resolveYear(month: number, day: number, today: string): string {
  const t = fromDateStr(today)
  const candidates = [t.getFullYear() - 1, t.getFullYear(), t.getFullYear() + 1]
  let best = ''
  let bestDist = Infinity
  for (const y of candidates) {
    const d = new Date(y, month - 1, day)
    if (d.getMonth() !== month - 1) continue // 無效日期，例如 2/30
    const s = toDateStr(d)
    // 偏好未來或近期過去：過去的日期加上懲罰
    const diff = (d.getTime() - t.getTime()) / 86400000
    const dist = diff >= -14 ? diff : -diff + 400
    if (dist < bestDist) { bestDist = dist; best = s }
  }
  return best
}

/** 下一個（含今天）指定星期幾的日期 */
export function nextWeekday(from: string, wd: number, offsetWeeks = 0, includeToday = true): string {
  const cur = weekdayOf(from)
  let delta = (wd - cur + 7) % 7
  if (delta === 0 && !includeToday) delta = 7
  return addDays(from, delta + offsetWeeks * 7)
}

/** 「本週一」＝當週（週一起算）的週一，不論已過與否 */
function weekdayInWeek(from: string, wd: number, weekOffset: number): string {
  const cur = weekdayOf(from)
  const back = cur === 0 ? 6 : cur - 1 // 回到本週一
  const monday = addDays(from, -back)
  const idx = wd === 0 ? 6 : wd - 1
  return addDays(monday, weekOffset * 7 + idx)
}

export function parseDates(text: string, today: string, consumer?: Consumer): DateResult {
  const res: DateResult = { dates: [], matched: false }
  const seen = new Set<string>()
  const push = (d: string) => { if (d && !seen.has(d)) { seen.add(d); res.dates.push(d) } }

  // --- 重複規則：每週一 / 每周一三五 / 每兩週的週二 ---
  const recur = text.match(/每\s*(?:(\d+)\s*)?(?:個)?\s*週\s*([一二三四五六日天](?:\s*[、,和跟與及]?\s*[一二三四五六日天])*)/)
  let recurWeekdays: number[] | null = null
  let interval = 1
  if (recur) {
    interval = recur[1] ? Math.max(1, +recur[1]) : 1
    recurWeekdays = [...recur[2].matchAll(/[一二三四五六日天]/g)].map((x) => WD_CHAR[x[0]])
    consumer?.consumeMatch(recur)
  } else {
    const everyDay = text.match(/每\s*天|天天/)
    if (everyDay) { recurWeekdays = [0, 1, 2, 3, 4, 5, 6]; consumer?.consumeMatch(everyDay) }
  }

  // --- 日期區間：9/1 到 9/30、9月1日~9月30日 ---
  const rangeRe = /(\d{1,2})\s*[\/月]\s*(\d{1,2})\s*[日號]?\s*(?:~|-|至|到)\s*(\d{1,2})\s*[\/月]\s*(\d{1,2})\s*[日號]?/
  const rm = text.match(rangeRe)
  let rangeFrom = ''
  let rangeTo = ''
  if (rm) {
    rangeFrom = resolveYear(+rm[1], +rm[2], today)
    rangeTo = resolveYear(+rm[3], +rm[4], rangeFrom)
    if (rangeTo < rangeFrom) rangeTo = resolveYear(+rm[3], +rm[4], addDays(rangeFrom, 300))
    consumer?.consumeMatch(rm)
    res.matched = true
  }

  // --- 整個月：9月 / 這個月 / 下個月 ---
  if (!rangeFrom) {
    const mm = text.match(/(?<![\d\/\-])(\d{1,2})\s*月(?!\s*\d)(?:份)?/)
    if (mm) {
      const y = fromDateStr(today).getFullYear()
      let anchor = `${y}-${pad2(+mm[1])}-01`
      if (anchor < startOfMonth(today)) anchor = `${y + 1}-${pad2(+mm[1])}-01`
      rangeFrom = anchor
      rangeTo = endOfMonth(anchor)
      consumer?.consumeMatch(mm)
      res.matched = true
    } else {
      const rel = text.match(/(這|本|下|下下)\s*個?\s*月/)
      if (rel) {
        const off = rel[1] === '下' ? 1 : rel[1] === '下下' ? 2 : 0
        const anchor = startOfMonth(addMonths(today, off))
        rangeFrom = anchor
        rangeTo = endOfMonth(anchor)
        consumer?.consumeMatch(rel)
        res.matched = true
      }
    }
  }

  // --- 「連續 N 週」「共 N 堂」 ---
  const nWeeks = text.match(/(?:連續|接下來|未來|共)\s*(\d+)\s*(?:週|周|次|堂|節)/)
  let countWeeks = nWeeks ? +nWeeks[1] : 0
  if (nWeeks) consumer?.consumeMatch(nWeeks)

  if (recurWeekdays?.length) {
    let from = rangeFrom
    let to = rangeTo
    if (!from) {
      from = today
      to = countWeeks
        ? addDays(today, countWeeks * 7 * interval)
        : endOfMonth(addMonths(today, 2))
    }
    res.recurring = { weekdays: [...new Set(recurWeekdays)].sort(), from, to, interval }
    res.matched = true
    return res
  }

  if (rangeFrom && rangeTo) {
    res.range = { from: rangeFrom, to: rangeTo }
    return res
  }

  // --- 相對日 ---
  const relMap: [RegExp, number][] = [
    [/大後天|大后天/, 3], [/後天|后天/, 2], [/明天|明日|隔天/, 1],
    [/今天|今日|本日/, 0], [/昨天|昨日/, -1], [/前天/, -2],
  ]
  for (const [re, off] of relMap) {
    const m = text.match(re)
    if (m) { push(addDays(today, off)); consumer?.consumeMatch(m); res.matched = true; break }
  }

  // --- 週幾（可帶 這/本/下/下下/上）---
  for (const m of text.matchAll(/(這|本|下下|下|上上|上)?\s*週\s*([一二三四五六日天])/g)) {
    const wd = WD_CHAR[m[2]]
    const q = m[1]
    let d: string
    if (q === '下') d = weekdayInWeek(today, wd, 1)
    else if (q === '下下') d = weekdayInWeek(today, wd, 2)
    else if (q === '上') d = weekdayInWeek(today, wd, -1)
    else if (q === '上上') d = weekdayInWeek(today, wd, -2)
    else if (q === '這' || q === '本') d = weekdayInWeek(today, wd, 0)
    else d = nextWeekday(today, wd, 0, true)
    push(d)
    consumer?.consumeMatch(m)
    res.matched = true
  }

  // --- 完整日期 YYYY/M/D ---
  for (const m of text.matchAll(/(\d{4})\s*[\/\-年]\s*(\d{1,2})\s*[\/\-月]\s*(\d{1,2})\s*[日號]?/g)) {
    const d = new Date(+m[1], +m[2] - 1, +m[3])
    if (d.getMonth() === +m[2] - 1) { push(toDateStr(d)); res.matched = true }
    consumer?.consumeMatch(m)
  }

  // --- M/D 或 M月D日（可用頓號列多個：8/25、8/26）---
  for (const m of text.matchAll(/(?<![\d\/\-:])(\d{1,2})\s*[\/月]\s*(\d{1,2})\s*[日號]?(?![\d:])/g)) {
    const mo = +m[1]; const da = +m[2]
    if (mo >= 1 && mo <= 12 && da >= 1 && da <= 31) {
      push(resolveYear(mo, da, today))
      consumer?.consumeMatch(m)
      res.matched = true
    }
  }

  // --- 只給日：25日 / 25號 ---
  if (!res.dates.length) {
    const m = text.match(/(?<![\d\/\-])(\d{1,2})\s*[日號](?![\d])/)
    if (m) {
      const da = +m[1]
      const t = fromDateStr(today)
      let cand = new Date(t.getFullYear(), t.getMonth(), da)
      if (cand.getDate() !== da) cand = new Date(t.getFullYear(), t.getMonth() + 1, da)
      else if (toDateStr(cand) < today) cand = new Date(t.getFullYear(), t.getMonth() + 1, da)
      push(toDateStr(cand))
      consumer?.consumeMatch(m)
      res.matched = true
    }
  }

  res.dates.sort()
  return res
}

export { addMinutes } from '../lib/date'

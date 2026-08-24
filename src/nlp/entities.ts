// ---------------------------------------------------------------------------
// 實體辨識：地點 / 課程 / 班級 / 代課旗標
// parse.ts（單句）與 block.ts（多行貼上）共用同一套規則
// ---------------------------------------------------------------------------

import { normalizeName } from '../db/repo'
import type { Consumer } from './normalize'
import type { ParseContext } from './types'

/** 內建課程別名 — 讓第一次使用、資料庫還空的時候也認得出來 */
export const BUILTIN_COURSES: { canonical: string; re: RegExp }[] = [
  { canonical: 'Minecraft 教育版', re: /minecraft\s*(教育版)?|麥塊|我的世界|當個創世神|創世神|(?<![a-z])mc(?![a-z])/i },
  { canonical: '樂高教育', re: /樂高\s*(教育)?|lego|wedo|spike\s*prime|spike|ev3|mindstorms|動力機械|簡單機械/i },
  { canonical: 'Scratch', re: /scratch|史克拉奇/i },
  { canonical: 'Python', re: /python|派森/i },
  { canonical: 'micro:bit', re: /micro:?bit|微位元/i },
  { canonical: 'App Inventor', re: /app\s*inventor/i },
]

export const LOCATION_SUFFIX =
  /([一-龥A-Za-z0-9]{1,10}?(?:分校|校區|教室|中心|分部|會館|國小|國中|小學|安親班|補習班|館))/g

/**
 * 「第一班」「第二班」在代課邀請裡是「第幾節」的意思，不是班級名稱。
 * 這種要當成節次標籤存進備註，不能拿去建立新班級。
 */
export const SESSION_LABEL = /第\s*([一二三四五六七八九十\d]{1,3})\s*[班節堂]/g

export const GROUP_PATTERNS = [
  /((?:學生)?組\s*[A-Za-z0-9]{1,3})/g,
  /(學生組\s*[一二三四五六七八九十甲乙丙丁]{1,2})/g,
  /([A-Za-z0-9]{1,3}\s*組(?![別長員]))/g,
  // 排除「第一班」這種節次寫法：開頭不能是「第」，前面也不能緊接著「第」
  /(?<!第)((?!第)[一-龥A-Za-z0-9]{1,6}班(?!級))/g,
]

export interface Located { text: string; index: number; length: number }

export function locate(hay: string, needle: string): Located | null {
  if (!needle) return null
  const i = hay.toLowerCase().indexOf(needle.toLowerCase())
  if (i < 0) return null
  return { text: hay.slice(i, i + needle.length), index: i, length: needle.length }
}

type Named = { id: string; name: string; aliases?: string[]; deleted: 0 | 1 }

/** 完整比對名稱或別名，取最長命中 */
export function findKnown<T extends Named>(
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

/**
 * 寬鬆比對：完整名稱找不到時，退而用名稱的前綴去找。
 * 老師常常只講「三民」而不是「三民分校」，這種簡稱要認得出來；
 * 但前綴至少要兩個字，而且只能對到唯一一筆，否則寧可放棄。
 */
export function findKnownLoose<T extends Named>(
  text: string, rows: T[],
): { rec: T; at: Located } | null {
  const exact = findKnown(text, rows)
  if (exact) return exact

  let best: { rec: T; at: Located } | null = null
  let ambiguous = false
  for (const r of rows) {
    if (r.deleted) continue
    for (const full of [r.name, ...(r.aliases ?? [])]) {
      for (let len = full.length - 1; len >= 2; len--) {
        const at = locate(text, full.slice(0, len))
        if (!at) continue
        if (best && best.rec.id !== r.id) {
          if (at.length > best.at.length) { best = { rec: r, at }; ambiguous = false }
          else if (at.length === best.at.length) ambiguous = true
        } else if (!best || at.length > best.at.length) {
          best = { rec: r, at }
        }
        break
      }
    }
  }
  return ambiguous ? null : best
}

export function stripLeadingCourse(s: string, ctx: ParseContext): string {
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

/** 這個名字是不是已知的地點/課程/班級 */
export function isKnownName(name: string, ctx: ParseContext): boolean {
  const n = normalizeName(name)
  if (!n) return false
  const pools = [ctx.locations, ctx.courses, ctx.groups] as { name: string; aliases?: string[] }[][]
  return pools.some((rows) =>
    rows.some((r) => [r.name, ...(r.aliases ?? [])].some((x) => normalizeName(x) === n)),
  )
}

// ---------------------------------------------------------------------------

export interface EntityHit {
  id?: string
  /** 資料庫還沒有這個項目，套用時要新建 */
  name?: string
}

export function matchLocation(text: string, ctx: ParseContext, c?: Consumer): EntityHit {
  const known = findKnownLoose(text, ctx.locations)
  if (known) { c?.consume(known.at.index, known.at.length); return { id: known.rec.id } }
  for (const m of text.matchAll(LOCATION_SUFFIX)) {
    const cand = m[1].trim()
    if (cand.length >= 2 && !/^(上課|下課|這個|那個)/.test(cand)) {
      c?.consumeMatch(m)
      return { name: cand }
    }
  }
  return {}
}

export function matchCourse(text: string, ctx: ParseContext, c?: Consumer): EntityHit {
  const known = findKnown(text, ctx.courses)
  if (known) { c?.consume(known.at.index, known.at.length); return { id: known.rec.id } }
  for (const b of BUILTIN_COURSES) {
    const m = text.match(b.re)
    if (m) { c?.consumeMatch(m); return { name: b.canonical } }
  }
  return {}
}

export function matchGroup(text: string, ctx: ParseContext, c?: Consumer): EntityHit {
  const known = findKnown(text, ctx.groups)
  if (known) { c?.consume(known.at.index, known.at.length); return { id: known.rec.id } }
  for (const re of GROUP_PATTERNS) {
    re.lastIndex = 0
    for (const m of text.matchAll(re)) {
      const cand = m[1].replace(/\s+/g, '')
      if (cand.length >= 2) { c?.consumeMatch(m); return { name: cand } }
    }
  }
  return {}
}

/** 「第一班」這種節次標籤，拿來當備註 */
export function matchSessionLabel(text: string, c?: Consumer): string | undefined {
  SESSION_LABEL.lastIndex = 0
  const m = SESSION_LABEL.exec(text)
  if (!m) return undefined
  c?.consumeMatch(m)
  return m[0].replace(/\s+/g, '')
}

export interface SubFlag {
  isSub: 0 | 1
  stated: boolean
  forWhom?: string
}

/** 「幫忙代課」的「忙」不是人名，這類字要排除 */
const NOT_A_NAME = /^(忙|我|你|妳|他|她|它|個|這|那|一下|們|老師)$/

export function matchSubstitute(text: string, c?: Consumer): SubFlag {
  const no = text.match(/(?:不是|不算|非|沒有|不用|不需要|不為)\s*代課/)
  if (no) { c?.consumeMatch(no); return { isSub: 0, stated: true } }

  const yes = text.match(/(?:幫\s*([一-龥A-Za-z]{1,6}?)\s*)?(?:代課|代班|代上)/)
  if (yes) {
    c?.consumeMatch(yes)
    const who = yes[1]?.trim()
    return {
      isSub: 1,
      stated: true,
      forWhom: who && !NOT_A_NAME.test(who) ? who : undefined,
    }
  }
  return { isSub: 0, stated: false }
}

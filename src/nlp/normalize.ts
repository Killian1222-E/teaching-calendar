// 文字正規化與中文數字處理

/** 全形數字/英文/標點 → 半形 */
export function toHalfWidth(s: string): string {
  return s
    .replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/　/g, ' ')
}

const CN_DIGIT: Record<string, number> = {
  零: 0, 〇: 0, 一: 1, 壹: 1, 二: 2, 兩: 2, 两: 2, 貳: 2, 三: 3, 參: 3, 四: 4,
  五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10, 廿: 20, 卅: 30,
}

/** 中文數字 → 阿拉伯數字，支援 十五 / 二十 / 二十五 / 卅一 */
export function cnToNum(s: string): number | null {
  if (!s) return null
  if (/^\d+$/.test(s)) return parseInt(s, 10)
  let total = 0
  let section = 0
  let sawAny = false
  for (const ch of s) {
    const v = CN_DIGIT[ch]
    if (v === undefined) return null
    sawAny = true
    if (v === 10) {
      section = (section === 0 ? 1 : section) * 10
    } else if (v === 20 || v === 30) {
      section += v
    } else {
      section += v
    }
  }
  total += section
  return sawAny ? total : null
}

/** 把句子裡的中文數字日期／時間換成阿拉伯數字，讓後續 regex 好處理 */
export function digitizeCn(input: string): string {
  let s = input
  const numWord = '[零〇一壹二兩两貳三參四五六七八九十廿卅]+'
  // 「十二月」「三十一日」「五點」「四十分」「三小時」「兩週」
  s = s.replace(new RegExp(`(${numWord})(?=\\s*[月日號点點分時时週周個小人位名])`, 'g'), (m) => {
    const n = cnToNum(m)
    return n === null ? m : String(n)
  })
  return s
}

/** 統一各種分隔符號與同義寫法 */
export function canonicalize(input: string): string {
  let s = toHalfWidth(input)
  s = s.replace(/[·・]/g, ' ')
  s = s.replace(/[~〜～]/g, '~')
  s = s.replace(/[—–－]/g, '-')
  s = s.replace(/\bto\b/gi, '~')
  s = s.replace(/星期|禮拜|拜/g, '週')
  s = s.replace(/周(?=[一二三四五六日天末])/g, '週')
  s = s.replace(/點半/g, '點30分')
  s = s.replace(/[点]/g, '點')
  s = s.replace(/时/g, '時')
  s = digitizeCn(s)
  return s
}

/** 把 regex 命中的區段從字串中挖掉，用來蒐集「沒被理解的殘句」 */
export class Consumer {
  private mask: boolean[]
  constructor(public readonly text: string) {
    this.mask = new Array(text.length).fill(false)
  }
  consume(index: number, length: number) {
    for (let i = index; i < index + length && i < this.mask.length; i++) this.mask[i] = true
  }
  consumeMatch(m: RegExpMatchArray | null) {
    if (m && m.index !== undefined) this.consume(m.index, m[0].length)
  }
  consumeAll(re: RegExp) {
    for (const m of this.text.matchAll(re)) this.consumeMatch(m)
  }
  /** 剩下沒被吃掉、且長度 >= 2 的片段 */
  leftovers(): string[] {
    const out: string[] = []
    let buf = ''
    for (let i = 0; i < this.text.length; i++) {
      if (this.mask[i]) {
        if (buf.trim().length >= 2) out.push(buf.trim())
        buf = ''
      } else buf += this.text[i]
    }
    if (buf.trim().length >= 2) out.push(buf.trim())
    return out
      .flatMap((x) => x.split(/[,，、。;；\s]+/))
      .map((x) => x.trim())
      .filter((x) => x.length >= 2 && !/^[的了是在和跟與及還有然後另外以及]+$/.test(x))
  }
}

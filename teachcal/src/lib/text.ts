/**
 * 月曆格子很窄，班級名稱要縮短才塞得下。
 * 「學生組B」→「組B」、「週一進階班」→「進階班」、其他一律截到 4 字。
 */
export function shortGroupName(name: string): string {
  if (!name) return ''
  let s = name.trim()
  s = s.replace(/^學生組\s*/, '組')
  s = s.replace(/^(週[一二三四五六日]|星期[一二三四五六日])\s*/, '')
  if (s.length > 4) s = s.slice(0, 4)
  return s
}

export function shortCourseName(name: string): string {
  if (!name) return ''
  const map: Record<string, string> = {
    'Minecraft 教育版': 'MC',
    'Minecraft': 'MC',
    '樂高教育': '樂高',
    'App Inventor': 'AI2',
  }
  if (map[name]) return map[name]
  return name.length > 4 ? name.slice(0, 4) : name
}

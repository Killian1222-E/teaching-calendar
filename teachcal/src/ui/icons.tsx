interface P { size?: number; className?: string }
const s = (p: P) => ({
  width: p.size ?? 20, height: p.size ?? 20, viewBox: '0 0 24 24',
  fill: 'none', stroke: 'currentColor', strokeWidth: 1.8,
  strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const,
  className: p.className,
})

export const IconCalendar = (p: P) => (
  <svg {...s(p)}><rect x="3" y="4.5" width="18" height="16" rx="2.5" /><path d="M3 9.5h18M8 2.5v4M16 2.5v4" /></svg>
)
export const IconSparkle = (p: P) => (
  <svg {...s(p)}><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" /><path d="M18.5 15.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z" /></svg>
)
export const IconUsers = (p: P) => (
  <svg {...s(p)}><path d="M16 20v-1.6A3.4 3.4 0 0 0 12.6 15H6.4A3.4 3.4 0 0 0 3 18.4V20" /><circle cx="9.5" cy="8" r="3.5" /><path d="M21 20v-1.6a3.4 3.4 0 0 0-2.6-3.3M15.5 4.7a3.5 3.5 0 0 1 0 6.6" /></svg>
)
export const IconRepeat = (p: P) => (
  <svg {...s(p)}><path d="M17 2.5l3.5 3.5L17 9.5" /><path d="M3.5 12V10a4 4 0 0 1 4-4h13" /><path d="M7 21.5L3.5 18 7 14.5" /><path d="M20.5 12v2a4 4 0 0 1-4 4h-13" /></svg>
)
export const IconSettings = (p: P) => (
  <svg {...s(p)}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5v.2a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1h.2a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z" /></svg>
)
export const IconPlus = (p: P) => <svg {...s(p)}><path d="M12 5v14M5 12h14" /></svg>
export const IconX = (p: P) => <svg {...s(p)}><path d="M18 6L6 18M6 6l12 12" /></svg>
export const IconChevL = (p: P) => <svg {...s(p)}><path d="M15 18l-6-6 6-6" /></svg>
export const IconChevR = (p: P) => <svg {...s(p)}><path d="M9 18l6-6-6-6" /></svg>
export const IconCheck = (p: P) => <svg {...s(p)}><path d="M20 6L9 17l-5-5" /></svg>
export const IconTrash = (p: P) => (
  <svg {...s(p)}><path d="M3.5 6h17M8 6V4.5A1.5 1.5 0 0 1 9.5 3h5A1.5 1.5 0 0 1 16 4.5V6m2.5 0v13a2 2 0 0 1-2 2h-9a2 2 0 0 1-2-2V6" /></svg>
)
export const IconSend = (p: P) => <svg {...s(p)}><path d="M4.5 12h15M13 5.5l6.5 6.5L13 18.5" /></svg>
export const IconSync = (p: P) => (
  <svg {...s(p)}><path d="M20.5 11.5a8.5 8.5 0 0 0-15-4.4M3.5 12.5a8.5 8.5 0 0 0 15 4.4" /><path d="M20.5 4.5v4h-4M3.5 19.5v-4h4" /></svg>
)
export const IconCloud = (p: P) => (
  <svg {...s(p)}><path d="M17.5 19a4.5 4.5 0 0 0 .6-8.96A6.5 6.5 0 0 0 5.6 11.2 3.9 3.9 0 0 0 6.5 19z" /></svg>
)
export const IconPin = (p: P) => (
  <svg {...s(p)}><path d="M12 21s7-6.3 7-11a7 7 0 1 0-14 0c0 4.7 7 11 7 11z" /><circle cx="12" cy="10" r="2.5" /></svg>
)
export const IconBook = (p: P) => (
  <svg {...s(p)}><path d="M4 4.5A1.5 1.5 0 0 1 5.5 3H19v18H5.5A1.5 1.5 0 0 1 4 19.5z" /><path d="M4 16.5h15" /></svg>
)
export const IconEdit = (p: P) => (
  <svg {...s(p)}><path d="M12 20h8" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4z" /></svg>
)
export const IconHistory = (p: P) => (
  <svg {...s(p)}><path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1" /><path d="M3.5 4v4h4" /><path d="M12 7.5V12l3 2" /></svg>
)
export const IconWarn = (p: P) => (
  <svg {...s(p)}><path d="M10.3 3.9L2 18a2 2 0 0 0 1.7 3h16.6A2 2 0 0 0 22 18L13.7 3.9a2 2 0 0 0-3.4 0z" /><path d="M12 9v4.5M12 17.5h.01" /></svg>
)
export const IconDown = (p: P) => <svg {...s(p)}><path d="M6 9l6 6 6-6" /></svg>
export const IconSun = (p: P) => (
  <svg {...s(p)}><circle cx="12" cy="12" r="4" /><path d="M12 2v2.5M12 19.5V22M4.2 4.2l1.8 1.8M18 18l1.8 1.8M2 12h2.5M19.5 12H22M4.2 19.8L6 18M18 6l1.8-1.8" /></svg>
)
export const IconMoon = (p: P) => (
  <svg {...s(p)}><path d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5a8.5 8.5 0 1 0 11 11z" /></svg>
)
export const IconAuto = (p: P) => (
  <svg {...s(p)}><circle cx="12" cy="12" r="8.5" /><path d="M12 3.5v17a8.5 8.5 0 0 0 0-17z" fill="currentColor" stroke="none" /></svg>
)

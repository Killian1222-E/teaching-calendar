import { useEffect, useState, type ReactElement } from 'react'
import { ensureSettings, saveSettings } from './db/local'
import { seedIfEmpty } from './db/seed'
import { onSynced, startAutoSync } from './db/sync'
import type { Lesson } from './db/types'
import { todayStr } from './lib/date'
import { AssistantView, INTRO, type Msg } from './ui/AssistantView'
import { CalendarView } from './ui/CalendarView'
import { GroupsView } from './ui/GroupsView'
import { LessonSheet } from './ui/LessonSheet'
import { PatternsView } from './ui/PatternsView'
import { SettingsView, applyTheme } from './ui/SettingsView'
import { ToastHost } from './ui/common'
import {
  IconAuto, IconCalendar, IconMoon, IconPlus, IconRepeat, IconSettings,
  IconSparkle, IconSun, IconUsers,
} from './ui/icons'
import { useAppData } from './ui/useData'

type Tab = 'cal' | 'ai' | 'groups' | 'patterns' | 'settings'

const TABS: { id: Tab; label: string; Icon: (p: any) => ReactElement }[] = [
  { id: 'cal', label: '行事曆', Icon: IconCalendar },
  { id: 'ai', label: 'AI 助理', Icon: IconSparkle },
  { id: 'groups', label: '班級', Icon: IconUsers },
  { id: 'patterns', label: '固定課表', Icon: IconRepeat },
  { id: 'settings', label: '設定', Icon: IconSettings },
]

const TITLES: Record<Tab, string> = {
  cal: '行事曆', ai: 'AI 排課助理', groups: '班級與學生', patterns: '固定課表', settings: '設定',
}

const THEME_ORDER = ['system', 'light', 'dark'] as const
const THEME_LABEL = { system: '跟隨系統', light: '淺色', dark: '深色' } as const

/** 主題快速切換：跟隨系統 → 淺色 → 深色 */
function ThemeToggle({ theme }: { theme: 'system' | 'light' | 'dark' }) {
  const next = THEME_ORDER[(THEME_ORDER.indexOf(theme) + 1) % 3]
  const Icon = theme === 'light' ? IconSun : theme === 'dark' ? IconMoon : IconAuto
  return (
    <button
      className="btn icon ghost"
      title={`外觀：${THEME_LABEL[theme]}（點一下切換成${THEME_LABEL[next]}）`}
      aria-label={`外觀：${THEME_LABEL[theme]}，切換成${THEME_LABEL[next]}`}
      onClick={async () => { await saveSettings({ theme: next }); applyTheme(next) }}
    >
      <Icon size={18} />
    </button>
  )
}

export default function App() {
  const [tab, setTab] = useState<Tab>('cal')
  const [sheet, setSheet] = useState<{ lesson?: Lesson; date?: string; kind?: 'class' | 'event' } | null>(null)
  const data = useAppData()
  // 對話留在這裡，切到行事曆看一眼再回來不會整串不見
  const [chat, setChat] = useState<Msg[]>([INTRO])

  useEffect(() => {
    (async () => {
      await seedIfEmpty()
      const s = await ensureSettings()
      applyTheme(s.theme ?? 'system')
      startAutoSync()
    })()
    return onSynced(() => {})
  }, [])

  return (
    <ToastHost>
      <div className="app">
        <nav className="nav" aria-label="主選單">
          {TABS.map(({ id, label, Icon }) => (
            <button key={id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}
              aria-current={tab === id ? 'page' : undefined}>
              <Icon size={21} />
              {label}
            </button>
          ))}
        </nav>

        <div className="col">
          <header className="topbar">
            <h1>{TITLES[tab]}</h1>
            {tab === 'cal' && (
              <span className="chip">{data.lessons.filter((l) => l.date >= todayStr() && l.status !== 'cancelled').length} 堂待上</span>
            )}
            <ThemeToggle theme={data.settings?.theme ?? 'system'} />
          </header>

          <main className={"main" + (tab === "ai" ? " chat-mode" : "")}>
            {tab === 'cal' && (
              <CalendarView
                data={data}
                onOpen={(l) => setSheet({ lesson: l })}
                onCreate={(d, kind) => setSheet({ date: d, kind })}
              />
            )}
            {tab === 'ai' && <AssistantView data={data} msgs={chat} setMsgs={setChat} />}
            {tab === 'groups' && <GroupsView data={data} />}
            {tab === 'patterns' && <PatternsView data={data} />}
            {tab === 'settings' && <SettingsView data={data} />}
          </main>
        </div>

        {tab === 'cal' && (
          <button className="fab" onClick={() => setSheet({ date: todayStr() })} aria-label="新增課程">
            <IconPlus size={24} />
          </button>
        )}

        {sheet && (
          <LessonSheet
            data={data}
            lesson={sheet.lesson}
            defaultDate={sheet.date}
            defaultKind={sheet.kind}
            onClose={() => setSheet(null)}
          />
        )}
      </div>
    </ToastHost>
  )
}

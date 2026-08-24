import { useMemo, useState } from 'react'
import type { Lesson } from '../db/types'
import {
  WEEKDAY_ZH, addDays, addMonths, formatDateZh, fromDateStr, monthGrid,
  relativeDayLabel, sameMonth, todayStr,
} from '../lib/date'
import { clashesOn, clashingDates } from '../db/repo'
import { rosterOf } from '../lib/roster'
import { shortGroupName } from '../lib/text'
import { Empty } from './common'
import { RosterPeek } from './GroupPeek'
import { IconChevL, IconChevR, IconPlus, IconUsers, IconWarn } from './icons'
import { LessonCard } from './LessonCard'
import type { AppData } from './useData'

type Mode = 'month' | 'agenda'

export function CalendarView({
  data, onOpen, onCreate,
}: {
  data: AppData
  onOpen: (l: Lesson) => void
  onCreate: (date: string, kind?: 'class' | 'event') => void
}) {
  const today = todayStr()
  const [anchor, setAnchor] = useState(today)
  const [selected, setSelected] = useState(today)
  const [mode, setMode] = useState<Mode>('month')
  const [peekGroup, setPeekGroup] = useState<string | null>(null)
  const [peekLesson, setPeekLesson] = useState<Lesson | null>(null)

  const byDate = useMemo(() => {
    const m = new Map<string, Lesson[]>()
    for (const l of data.lessons) {
      if (l.deleted) continue
      const arr = m.get(l.date) ?? []
      arr.push(l)
      m.set(l.date, arr)
    }
    return m
  }, [data.lessons])

  const grid = useMemo(() => monthGrid(anchor), [anchor])
  /** 時段互相重疊的日期，月曆上用紅字標出來 */
  const clashes = useMemo(() => clashingDates(data.lessons), [data.lessons])
  const dayClashes = useMemo(() => clashesOn(selected, data.lessons), [selected, data.lessons])
  const dayLessons = byDate.get(selected) ?? []

  /** 這天出現的班級（去重），給日期標題列的名單快捷用 */
  const dayGroups = useMemo(() => {
    const ids = new Set<string>()
    for (const l of dayLessons) if (l.group_id && l.status !== 'cancelled') ids.add(l.group_id)
    return [...ids]
  }, [dayLessons])

  /** 沒有綁班級的行程（代課、大活動），名單記在該堂課上 */
  const dayLooseLessons = useMemo(
    () => dayLessons.filter((l) => l.status !== 'cancelled' && !l.group_id),
    [dayLessons],
  )

  const upcoming = useMemo(() => {
    const from = today
    const to = addDays(today, 60)
    const rows = data.lessons.filter((l) => !l.deleted && l.date >= from && l.date <= to)
    const groups = new Map<string, Lesson[]>()
    for (const l of rows) {
      const arr = groups.get(l.date) ?? []
      arr.push(l)
      groups.set(l.date, arr)
    }
    return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [data.lessons, today])

  return (
    <>
      <div className="cal-sticky">
      <div className="cal-head">
        {mode === 'month' ? (
          <>
            <div className="cal-title">
              {fromDateStr(anchor).getFullYear()} 年 {fromDateStr(anchor).getMonth() + 1} 月
            </div>
            <div className="spacer" />
            <button className="btn icon ghost" onClick={() => setAnchor(addMonths(anchor, -1))} aria-label="上個月">
              <IconChevL size={19} />
            </button>
            <button className="btn sm ghost" onClick={() => { setAnchor(today); setSelected(today) }}>今天</button>
            <button className="btn icon ghost" onClick={() => setAnchor(addMonths(anchor, 1))} aria-label="下個月">
              <IconChevR size={19} />
            </button>
          </>
        ) : (
          <>
            <div className="cal-title">未來行程</div>
            <div className="spacer" />
          </>
        )}
      </div>

      <div style={{ padding: '0 14px 8px' }}>
        <div className="switch">
          <button className={mode === 'month' ? 'on' : ''} onClick={() => setMode('month')}>月曆</button>
          <button className={mode === 'agenda' ? 'on' : ''} onClick={() => setMode('agenda')}>清單</button>
        </div>
      </div>

      {mode === 'month' && (
        <div className="cal-week">
          {WEEKDAY_ZH.map((w, i) => (
            <div key={w} className={'wd' + (i === 0 || i === 6 ? ' we' : '')}>{w}</div>
          ))}
        </div>
      )}
      </div>

      {mode === 'month' && (
        <>
          <div className="cal-grid">
            {grid.map((d) => {
              const rows = (byDate.get(d) ?? []).filter((l) => l.status !== 'cancelled')
              const hasClash = clashes.has(d)
              const cls = [
                'cal-cell',
                sameMonth(d, anchor) ? '' : 'out',
                d === today ? 'today' : '',
                d === selected ? 'sel' : '',
                hasClash ? 'clash' : '',
              ].filter(Boolean).join(' ')
              return (
                <button key={d} className={cls} onClick={() => setSelected(d)}
                  title={hasClash ? '這天有時段重疊' : undefined}>
                  {hasClash && <span className="clash-dot" />}
                  <span className="num">{fromDateStr(d).getDate()}</span>
                  <span className="tags">
                    {rows.slice(0, 3).map((l) => {
                      const isEv = l.kind === 'event'
                      const g = data.nameOf.group(l.group_id)
                      const label = isEv
                        ? shortGroupName(l.title || '大活動')
                        : g ? shortGroupName(g)
                        : l.is_substitute ? '代課' : ''
                      const color = isEv ? 'var(--sub)' : data.colorOf.course(l.course_id)
                      const n = rosterOf(l, data.studentsOf).count
                      return (
                        <span
                          key={l.id}
                          className={'ctag' + (label ? '' : ' dot-only') + (isEv ? ' ev' : '')}
                          style={{ '--tag': color } as React.CSSProperties}
                          title={`${l.start_time} ${data.nameOf.course(l.course_id)} ${label}${n ? ` ${n}人` : ''}`}
                        >
                          {label}
                        </span>
                      )
                    })}
                  </span>
                  {rows.length > 3 && <span className="more">+{rows.length - 3}</span>}
                </button>
              )
            })}
          </div>

          <div className="pad" style={{ paddingTop: 4 }}>
            <div className="day-head">
              <span className="d">{formatDateZh(selected)}</span>
              <span className="r">{relativeDayLabel(selected)}</span>
              <span className="spacer" />
              <button className="btn sm" onClick={() => onCreate(selected)}>
                <IconPlus size={15} /> 課程
              </button>
              <button className="btn sm" onClick={() => onCreate(selected, 'event')}>
                <IconPlus size={15} /> 大活動
              </button>
            </div>

            {dayClashes.length > 0 && (
              <div className="banner err" style={{ marginBottom: 10 }}>
                <IconWarn size={16} />
                <span>
                  這天有 {dayClashes.length} 堂課時段重疊：
                  {dayClashes.map((l) => `${l.start_time}–${l.end_time}`).join('、')}。
                  還在喬時間就先留著，確定了再改或刪掉。
                </span>
              </div>
            )}

            {(dayGroups.length > 0 || dayLooseLessons.length > 0) && (
              <div className="row wrap" style={{ marginBottom: 10, gap: 6 }}>
                <span className="tiny faint">名單快捷</span>
                {dayGroups.map((gid) => (
                  <button key={gid} className="chip accent roster-btn" onClick={() => setPeekGroup(gid)}>
                    <IconUsers size={13} />
                    {data.nameOf.group(gid)}
                    <span style={{ opacity: .7 }}>· {data.studentsOf(gid).length}人</span>
                  </button>
                ))}
                {dayLooseLessons.map((l) => (
                  <button key={l.id} className="chip sub roster-btn" onClick={() => setPeekLesson(l)}>
                    <IconUsers size={13} />
                    {l.kind === 'event' ? (l.title || '大活動') : '代課名單'}
                    <span style={{ opacity: .7 }}>· {rosterOf(l, data.studentsOf).count}人</span>
                  </button>
                ))}
              </div>
            )}

            {dayLessons.length === 0 ? (
              <Empty icon="🗓" title="這天沒有課" sub="按「新增」或到 AI 助理用一句話排課" />
            ) : (
              <div className="stack">
                {dayLessons.map((l) => (
                  <LessonCard key={l.id} lesson={l} data={data}
                    onClick={() => onOpen(l)} onPeekRoster={setPeekLesson} />
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {mode === 'agenda' && (
        <div className="pad" style={{ paddingTop: 0 }}>
          {upcoming.length === 0 ? (
            <Empty icon="✨" title="未來 60 天沒有排課" sub="到 AI 助理輸入「8/25 1300-1430 三民分校 Minecraft 學生組B」試試" />
          ) : (
            upcoming.map(([date, rows]) => (
              <div key={date}>
                <div className="day-head">
                  <span className="d">{formatDateZh(date)}</span>
                  <span className="r">{relativeDayLabel(date)}</span>
                </div>
                <div className="stack">
                  {rows.map((l) => (
                    <LessonCard key={l.id} lesson={l} data={data}
                      onClick={() => onOpen(l)} onPeekRoster={setPeekLesson} />
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {peekGroup && (
        <RosterPeek groupId={peekGroup} data={data} onClose={() => setPeekGroup(null)} />
      )}
      {peekLesson && (
        <RosterPeek lesson={peekLesson} data={data} onClose={() => setPeekLesson(null)} />
      )}
    </>
  )
}

import { useState } from 'react'
import { create, latestTopicOfGroup, recentHistory, remove, update } from '../db/repo'
import type { Lesson, Student } from '../db/types'
import { formatDateZh } from '../lib/date'
import { eventScale, rosterOf } from '../lib/roster'
import { Empty, Sheet, useToast } from './common'
import { IconPlus, IconTrash } from './icons'
import type { AppData } from './useData'

/**
 * 名單快捷視窗。三種情境共用：
 *   1. 常態班級 → 顯示班級名單與最近進度
 *   2. 代課     → 顯示這堂課自己記的臨時名單
 *   3. 大活動   → 顯示人數，名單可有可無
 */
export function RosterPeek({
  data, groupId, lesson, onClose,
}: {
  data: AppData
  groupId?: string
  lesson?: Lesson
  onClose: () => void
}) {
  const toast = useToast()
  const gid = groupId ?? lesson?.group_id
  const isEvent = lesson?.kind === 'event'
  const usesGuest = !!lesson && (isEvent || (!!lesson.is_substitute && !lesson.group_id))

  if (usesGuest && lesson) return <GuestRoster data={data} lesson={lesson} onClose={onClose} />
  if (!gid) return null

  const group = data.groups.find((g) => g.id === gid)
  if (!group) return null

  const students = data.studentsOf(gid)
  const prev = latestTopicOfGroup(gid, data.lessons)
  const history = recentHistory(gid, data.lessons, 6)
  const upcoming = data.lessons.filter(
    (l) => !l.deleted && l.group_id === gid && l.status !== 'cancelled',
  )

  return (
    <RosterSheet
      title={group.name}
      onClose={onClose}
      chips={
        <>
          <span className="chip accent">{students.length} 位學生</span>
          <span className="chip">{upcoming.length} 堂課</span>
          {group.aliases.length > 0 && <span className="chip">別名：{group.aliases.join('、')}</span>}
        </>
      }
      banner={prev && (
        <div className="banner ok">
          <span>
            上次上到「{prev.topic}」
            {prev.course_id ? `（${data.nameOf.course(prev.course_id)}）` : ''}
            ・{formatDateZh(prev.date!)}
          </span>
        </div>
      )}
      note={group.note}
      names={students.map((s) => ({ id: s.id, name: s.name, note: s.note }))}
      emptyHint="這班還沒有名單"
      onRemove={async (id) => { await remove('students', id); toast('已移除') }}
      onAdd={async (names) => {
        for (const n of names) await create<Student>('students', { group_id: gid, name: n, active: 1 })
        toast(`已加入 ${names.length} 位`)
      }}
      history={history.length > 1 ? (
        <>
          <div className="section-title" style={{ marginTop: 4 }}>最近上課紀錄</div>
          <div className="list">
            {history.map((l) => (
              <div className="item" key={l.id} style={{ cursor: 'default' }}>
                <div className="t">
                  <div className="n small">{formatDateZh(l.date)}</div>
                  <div className="s">
                    {data.nameOf.course(l.course_id) || '未指定課程'}
                    {l.topic ? `・${l.topic}` : '・（沒填內容）'}
                  </div>
                </div>
                {l.is_substitute ? <span className="chip sub">代課</span> : null}
              </div>
            ))}
          </div>
          <div className="tiny faint">
            這一班的課程可以每週不同，助理不會自作主張，沒講就會提醒你指定。
          </div>
        </>
      ) : null}
    />
  )
}

// ---------------------------------------------------------------------------

function GuestRoster({ data, lesson, onClose }: { data: AppData; lesson: Lesson; onClose: () => void }) {
  const toast = useToast()
  const isEvent = lesson.kind === 'event'
  const roster = rosterOf(lesson, data.studentsOf)
  const scale = isEvent ? eventScale(roster.count) : null
  const names = lesson.guest_students ?? []

  const setNames = async (next: string[]) => {
    await update<Lesson>('lessons', lesson.id, {
      guest_students: next,
      headcount: lesson.headcount && lesson.headcount > next.length ? lesson.headcount : next.length || undefined,
    })
  }

  return (
    <RosterSheet
      title={isEvent ? (lesson.title || '大活動') : '代課名單'}
      onClose={onClose}
      chips={
        <>
          <span className={'chip ' + (scale ? scale.tone : 'sub')}>
            {roster.count} 人{scale ? `・${scale.label}` : ''}
          </span>
          <span className="chip">{formatDateZh(lesson.date)}</span>
          {data.nameOf.location(lesson.location_id) && (
            <span className="chip">{data.nameOf.location(lesson.location_id)}</span>
          )}
        </>
      }
      banner={
        <div className="banner info">
          <span>
            {isEvent
              ? '大活動的參加者不屬於你的常態班級，名單只留在這一場。人數多的時候可以只記人數。'
              : '代課帶的不是你自己的學生，名字只記在這堂課上，不會加進任何班級。'}
          </span>
        </div>
      }
      note={lesson.note}
      names={names.map((n) => ({ id: n, name: n }))}
      emptyHint={isEvent ? '這場活動還沒有名單（只記人數也可以）' : '還沒有填學生名字'}
      onRemove={async (id) => { await setNames(names.filter((n) => n !== id)); toast('已移除') }}
      onAdd={async (adds) => {
        const merged = [...names]
        for (const n of adds) if (!merged.includes(n)) merged.push(n)
        await setNames(merged)
        toast(`已加入 ${adds.length} 位`)
      }}
      extra={
        <div className="row" style={{ gap: 8 }}>
          <span className="small muted" style={{ flex: 1 }}>總人數</span>
          <input className="input" type="number" min={0} max={5000} style={{ flex: '0 0 110px' }}
            value={lesson.headcount ?? ''}
            onChange={async (e) => {
              const v = e.target.value ? Number(e.target.value) : undefined
              await update<Lesson>('lessons', lesson.id, { headcount: v })
            }} />
        </div>
      }
    />
  )
}

// ---------------------------------------------------------------------------

function RosterSheet({
  title, onClose, chips, banner, note, names, emptyHint, onRemove, onAdd, history, extra,
}: {
  title: string
  onClose: () => void
  chips?: React.ReactNode
  banner?: React.ReactNode
  note?: string
  names: { id: string; name: string; note?: string }[]
  emptyHint: string
  onRemove: (id: string) => Promise<void>
  onAdd: (names: string[]) => Promise<void>
  history?: React.ReactNode
  extra?: React.ReactNode
}) {
  const [adding, setAdding] = useState('')

  const submit = async () => {
    const list = adding.split(/[\s,，、;；\n]+/).map((x) => x.trim()).filter(Boolean)
    if (!list.length) return
    await onAdd(list)
    setAdding('')
  }

  return (
    <Sheet title={title} onClose={onClose}
      footer={<button className="btn primary block" onClick={onClose}>關閉</button>}>
      {chips && <div className="row wrap" style={{ gap: 6 }}>{chips}</div>}
      {banner}
      {note && <div className="small muted">{note}</div>}
      {extra}

      {names.length === 0 ? (
        <Empty icon="👦" title={emptyHint} sub="在下面直接輸入姓名加進來" />
      ) : (
        <div className="list">
          {names.map((s, i) => (
            <div className="item" key={s.id} style={{ cursor: 'default' }}>
              <span className="chip mono" style={{ minWidth: 30, justifyContent: 'center' }}>{i + 1}</span>
              <div className="t">
                <div className="n">{s.name}</div>
                {s.note && <div className="s">{s.note}</div>}
              </div>
              <button className="btn ghost sm danger" aria-label={`移除 ${s.name}`}
                onClick={() => onRemove(s.id)}>
                <IconTrash size={15} />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="row" style={{ gap: 7 }}>
        <input className="input" value={adding} placeholder="加名字，可一次貼多個"
          onChange={(e) => setAdding(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); submit() } }} />
        <button className="btn primary" style={{ flex: '0 0 auto' }} disabled={!adding.trim()} onClick={submit}>
          <IconPlus size={16} />
        </button>
      </div>

      {history}
    </Sheet>
  )
}

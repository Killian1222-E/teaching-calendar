import { useMemo, useState } from 'react'
import { create, findPrevTopic, learnPattern, patternExistsFor, remove, update } from '../db/repo'
import type { AttendanceMark, Lesson, LessonKind } from '../db/types'
import { WEEKDAY_ZH, addMinutes, formatDateZh, timeToMin, weekdayOf } from '../lib/date'
import { eventScale, rosterOf } from '../lib/roster'
import { Confirm, Field, Select, Sheet, TagEditor, useToast } from './common'
import { IconHistory, IconTrash, IconUsers } from './icons'
import type { AppData } from './useData'

export interface LessonSheetProps {
  data: AppData
  lesson?: Lesson
  defaultDate?: string
  defaultKind?: LessonKind
  onClose: () => void
}

const BLANK = (date: string, minutes: number, kind: LessonKind) => ({
  kind,
  date,
  start_time: '14:00',
  end_time: addMinutes('14:00', kind === 'event' ? 180 : minutes),
  is_substitute: 0 as 0 | 1,
  guest_students: [] as string[],
  status: 'planned' as const,
  attendance: {} as Record<string, AttendanceMark>,
})

export function LessonSheet({ data, lesson, defaultDate, defaultKind, onClose }: LessonSheetProps) {
  const toast = useToast()
  const isNew = !lesson
  const minutes = data.settings?.default_lesson_minutes ?? 90
  const [f, setF] = useState<Partial<Lesson>>(() =>
    lesson
      ? { ...lesson, guest_students: lesson.guest_students ?? [], kind: lesson.kind ?? 'class' }
      : BLANK(defaultDate ?? new Date().toISOString().slice(0, 10), minutes, defaultKind ?? 'class'),
  )
  const [confirmDel, setConfirmDel] = useState(false)
  const [askPattern, setAskPattern] = useState<Lesson | null>(null)
  const [bulk, setBulk] = useState('')

  const set = (patch: Partial<Lesson>) => setF((p) => ({ ...p, ...patch }))
  const isEvent = f.kind === 'event'

  const prev = useMemo(
    () => (!isEvent && f.date && f.start_time ? findPrevTopic(f as Lesson, data.lessons) : null),
    [isEvent, f.date, f.start_time, f.group_id, f.course_id, f.prev_topic_manual, data.lessons],
  )

  const roster = rosterOf(
    {
      kind: f.kind ?? 'class',
      group_id: f.group_id,
      is_substitute: (f.is_substitute ?? 0) as 0 | 1,
      guest_students: f.guest_students ?? [],
      headcount: f.headcount,
    },
    data.studentsOf,
  )
  const groupStudents = data.studentsOf(f.group_id)
  /** 代課或大活動時，出席名單改用這堂課自己的臨時名單 */
  const usesGuestList = isEvent || (!!f.is_substitute && !f.group_id)

  const applyPatternHints = (patch: Partial<Lesson>) => {
    if (isEvent) { set(patch); return }
    const merged = { ...f, ...patch }
    const wd = merged.date ? weekdayOf(merged.date) : -1
    const p = data.patterns.find(
      (x) => x.active && x.weekday === wd && (!merged.start_time || x.start_time === merged.start_time),
    )
    if (p) {
      if (!merged.group_id) patch.group_id = p.group_id
      if (!merged.course_id) patch.course_id = p.course_id
      if (!merged.location_id) patch.location_id = p.location_id
      if (!patch.start_time && !merged.start_time) {
        patch.start_time = p.start_time
        patch.end_time = p.end_time
      }
    }
    set(patch)
  }

  const addBulkNames = () => {
    const names = bulk.split(/[\s,，、;；\n]+/).map((x) => x.trim()).filter(Boolean)
    if (!names.length) return
    const cur = f.guest_students ?? []
    const merged = [...cur]
    for (const n of names) if (!merged.includes(n)) merged.push(n)
    set({ guest_students: merged, headcount: f.headcount ?? undefined })
    setBulk('')
  }

  const save = async () => {
    if (!f.date || !f.start_time) { toast('請填日期與開始時間'); return }
    if (isEvent && !f.title?.trim() && !f.course_id) { toast('請填活動名稱'); return }
    const end = f.end_time && timeToMin(f.end_time) > timeToMin(f.start_time)
      ? f.end_time : addMinutes(f.start_time, minutes)

    const payload: any = {
      kind: f.kind ?? 'class',
      title: isEvent ? f.title?.trim() || undefined : undefined,
      date: f.date,
      start_time: f.start_time,
      end_time: end,
      location_id: f.location_id,
      course_id: f.course_id,
      group_id: isEvent ? undefined : f.group_id,
      is_substitute: f.is_substitute ? 1 : 0,
      substitute_for: f.substitute_for?.trim() || undefined,
      guest_students: (f.guest_students ?? []).filter((n) => n.trim()),
      headcount: f.headcount && f.headcount > 0 ? Math.round(f.headcount) : undefined,
      topic: f.topic?.trim() || undefined,
      prev_topic_manual: f.prev_topic_manual?.trim() || undefined,
      note: f.note?.trim() || undefined,
      status: f.status ?? 'planned',
      attendance: f.attendance ?? {},
    }

    let saved: Lesson
    if (isNew) saved = await create<Lesson>('lessons', payload)
    else saved = (await update<Lesson>('lessons', lesson!.id, payload))!

    // 大活動是一次性的，不會問要不要記成固定課表
    if (isNew && !isEvent && saved.group_id && !patternExistsFor(data.patterns, saved)) {
      setAskPattern(saved)
      return
    }
    toast(isNew ? (isEvent ? '已加入大活動' : '已加入行事曆') : '已更新')
    onClose()
  }

  const toggleAttendance = (key: string) => {
    const cur = (f.attendance ?? {})[key]
    const next: AttendanceMark | undefined =
      cur === undefined ? 'present' : cur === 'present' ? 'late' : cur === 'late' ? 'absent' : undefined
    const a = { ...(f.attendance ?? {}) }
    if (next) a[key] = next; else delete a[key]
    set({ attendance: a })
  }

  if (askPattern) {
    return (
      <Confirm
        title="要記成固定課表嗎？"
        body={`以後每週${WEEKDAY_ZH[weekdayOf(askPattern.date)]} ${askPattern.start_time}-${askPattern.end_time} 預設就是「${data.nameOf.group(askPattern.group_id)}」。之後你只要說日期，助理就會自動帶入班級、地點和課程。`}
        confirmLabel="好，記起來"
        onConfirm={async () => { await learnPattern(askPattern); toast('已加入固定課表'); onClose() }}
        onCancel={() => { toast('已加入行事曆'); onClose() }}
      />
    )
  }

  if (confirmDel && lesson) {
    return (
      <Confirm
        title={isEvent ? '刪除這場活動？' : '刪除這堂課？'}
        body="這個動作會同步到你其他裝置。"
        confirmLabel="刪除" danger
        onConfirm={async () => { await remove('lessons', lesson.id); toast('已刪除'); onClose() }}
        onCancel={() => setConfirmDel(false)}
      />
    )
  }

  const attendanceKeys = usesGuestList
    ? (f.guest_students ?? []).map((n) => ({ key: 'g:' + n, name: n }))
    : groupStudents.map((s) => ({ key: s.id, name: s.name }))
  const presentCount = Object.values(f.attendance ?? {}).filter((v) => v !== 'absent').length
  const scale = isEvent ? eventScale(roster.count) : null

  return (
    <Sheet
      title={isNew ? (isEvent ? '新增大活動' : '新增課程') : (isEvent ? '活動詳情' : '課程詳情')}
      onClose={onClose}
      footer={
        <>
          {!isNew && (
            <button className="btn danger" style={{ flex: '0 0 46px' }} onClick={() => setConfirmDel(true)} aria-label="刪除">
              <IconTrash size={18} />
            </button>
          )}
          <button className="btn" onClick={onClose}>取消</button>
          <button className="btn primary" onClick={save}>{isNew ? '加入行事曆' : '儲存'}</button>
        </>
      }
    >
      <Field label="類型">
        <div className="switch">
          <button className={!isEvent ? 'on' : ''}
            onClick={() => set({ kind: 'class' })}>一般課程</button>
          <button className={isEvent ? 'on' : ''}
            onClick={() => set({
              kind: 'event',
              group_id: undefined,
              end_time: f.start_time ? addMinutes(f.start_time, 180) : f.end_time,
            })}>大活動</button>
        </div>
      </Field>

      {isEvent && (
        <Field label="活動名稱" hint="例如：中鋼員工子女營、國小科技體驗營">
          <input className="input" placeholder="活動名稱" value={f.title ?? ''}
            onChange={(e) => set({ title: e.target.value })} />
        </Field>
      )}

      {prev && (
        <div className="banner info">
          <IconHistory size={17} />
          <div>
            <b>上次上到：{prev.topic}</b>
            <div className="tiny" style={{ opacity: .8, marginTop: 2 }}>
              {prev.source === 'manual' ? '你手動註記的' : `${formatDateZh(prev.date!)}・自動從紀錄找出來`}
            </div>
          </div>
        </div>
      )}

      <div className="grid2">
        <Field label="日期">
          <input className="input" type="date" value={f.date ?? ''}
            onChange={(e) => applyPatternHints({ date: e.target.value })} />
        </Field>
        <Field label="星期">
          <input className="input" readOnly value={f.date ? '週' + WEEKDAY_ZH[weekdayOf(f.date)] : ''} />
        </Field>
      </div>

      <div className="grid2">
        <Field label="開始">
          <input className="input" type="time" value={f.start_time ?? ''}
            onChange={(e) => {
              const st = e.target.value
              applyPatternHints({ start_time: st, end_time: addMinutes(st, isEvent ? 180 : minutes) })
            }} />
        </Field>
        <Field label="結束">
          <input className="input" type="time" value={f.end_time ?? ''}
            onChange={(e) => set({ end_time: e.target.value })} />
        </Field>
      </div>

      <Field label="地點">
        <Select value={f.location_id} onChange={(v) => set({ location_id: v })} options={data.locations} />
      </Field>
      <Field label="課程">
        <Select value={f.course_id} onChange={(v) => set({ course_id: v })} options={data.courses} />
      </Field>

      {!isEvent && (
        <Field label="班級 / 學生組">
          <Select value={f.group_id} onChange={(v) => set({ group_id: v })} options={data.groups} />
        </Field>
      )}

      <hr className="sep" />

      {!isEvent && (
        <div className="row wrap">
          <label className="row" style={{ gap: 8, cursor: 'pointer', flex: 1, minWidth: 150 }}>
            <input type="checkbox" checked={!!f.is_substitute}
              onChange={(e) => set({ is_substitute: e.target.checked ? 1 : 0 })}
              style={{ width: 18, height: 18, accentColor: 'var(--sub)' }} />
            <span style={{ fontWeight: 600, fontSize: 14.5 }}>這是代課</span>
          </label>
          {!!f.is_substitute && (
            <input className="input" style={{ flex: '0 0 150px' }} placeholder="代誰的課（可留白）"
              value={f.substitute_for ?? ''} onChange={(e) => set({ substitute_for: e.target.value })} />
          )}
        </div>
      )}

      {/* ---- 人數與名單 ---- */}
      <div className="card pad stack" style={{ gap: 10 }}>
        <div className="row">
          <IconUsers size={16} />
          <span style={{ fontWeight: 650, fontSize: 14 }}>學生人數</span>
          <span className="spacer" />
          <span className={'chip ' + (scale ? scale.tone : 'accent')}>
            {roster.count} 人{scale ? `・${scale.label}` : ''}
          </span>
        </div>

        {usesGuestList ? (
          <>
            <div className="tiny faint">
              {isEvent
                ? '大活動人數多，可以只填人數；要點名的話也能把名字打進來。'
                : '代課帶的不是你自己的班級，名字直接記在這堂課上，不會加進任何班級名單。'}
            </div>

            <Field label="人數">
              <input className="input" type="number" min={0} max={2000} inputMode="numeric"
                placeholder={isEvent ? '例如：80' : '例如：8'}
                value={f.headcount ?? ''}
                onChange={(e) => set({ headcount: e.target.value ? Number(e.target.value) : undefined })} />
            </Field>

            <Field label="學生名單（可留白）">
              <TagEditor
                values={f.guest_students ?? []}
                onChange={(v) => set({ guest_students: v })}
                placeholder="打名字後按 Enter"
              />
            </Field>

            <div className="row" style={{ gap: 7 }}>
              <input className="input" value={bulk} placeholder="一次貼多個名字（空白或逗號隔開）"
                onChange={(e) => setBulk(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); addBulkNames() } }} />
              <button className="btn" style={{ flex: '0 0 auto' }} onClick={addBulkNames} disabled={!bulk.trim()}>批次加入</button>
            </div>
          </>
        ) : (
          <div className="tiny faint">
            {f.group_id
              ? `來自「${data.nameOf.group(f.group_id)}」的名單，要增減學生請到「班級」分頁。`
              : '選一個班級之後就會自動帶出人數。'}
          </div>
        )}
      </div>

      <Field label={isEvent ? '活動內容' : '這堂課上的內容'}
        hint={isEvent ? undefined : '填了之後，下一堂同班級的課就會自動顯示「上次上到…」'}>
        <input className="input" placeholder={isEvent ? '例如：機器人闖關體驗' : '例如：狗狗圍欄'}
          value={f.topic ?? ''} onChange={(e) => set({ topic: e.target.value })} />
      </Field>

      {!isEvent && (!prev || prev.source === 'manual') ? (
        <Field label="上次上的內容（手動註記）" hint="還沒有歷史紀錄時可以自己填">
          <input className="input" placeholder="例如：紅石電路" value={f.prev_topic_manual ?? ''}
            onChange={(e) => set({ prev_topic_manual: e.target.value })} />
        </Field>
      ) : null}

      <Field label="備註">
        <textarea className="textarea" style={{ minHeight: 60 }} value={f.note ?? ''}
          onChange={(e) => set({ note: e.target.value })} />
      </Field>

      <Field label="狀態">
        <div className="switch">
          {(['planned', 'done', 'cancelled'] as const).map((s) => (
            <button key={s} className={f.status === s ? 'on' : ''} onClick={() => set({ status: s })}>
              {s === 'planned' ? (isEvent ? '待舉辦' : '待上課') : s === 'done' ? '已完成' : (isEvent ? '取消' : '停課')}
            </button>
          ))}
        </div>
      </Field>

      {attendanceKeys.length > 0 && (
        <>
          <hr className="sep" />
          <div className="row">
            <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-dim)' }}>出席（點一下切換）</div>
            <div className="spacer" />
            <span className="chip">{presentCount}/{attendanceKeys.length}</span>
          </div>
          <div className="row wrap">
            {attendanceKeys.map(({ key, name }) => {
              const m = (f.attendance ?? {})[key]
              const cls = m === 'present' ? 'chip ok' : m === 'late' ? 'chip warn'
                : m === 'absent' ? 'chip danger' : 'chip'
              const label = m === 'present' ? '到' : m === 'late' ? '遲' : m === 'absent' ? '缺' : ''
              return (
                <button key={key} className={cls} style={{ cursor: 'pointer' }} onClick={() => toggleAttendance(key)}>
                  {name}{label && ` · ${label}`}
                </button>
              )
            })}
          </div>
        </>
      )}
    </Sheet>
  )
}

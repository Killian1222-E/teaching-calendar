import { useMemo, useState } from 'react'
import { create, expandRecurring, findConflict, remove, update } from '../db/repo'
import type { Lesson, Pattern } from '../db/types'
import { WEEKDAY_ZH, addDays, addMinutes, endOfMonth, formatDateZh, todayStr } from '../lib/date'
import { Confirm, Empty, Field, Sheet, useToast } from './common'
import { IconChevR, IconPlus, IconRepeat, IconTrash } from './icons'
import type { AppData } from './useData'

export function PatternsView({ data }: { data: AppData }) {
  const [editing, setEditing] = useState<Pattern | 'new' | null>(null)
  const [generating, setGenerating] = useState(false)

  const byDay = useMemo(() => {
    const m = new Map<number, Pattern[]>()
    for (const p of data.patterns) {
      const arr = m.get(p.weekday) ?? []
      arr.push(p)
      m.set(p.weekday, arr)
    }
    return m
  }, [data.patterns])

  return (
    <div className="pad">
      <div className="row" style={{ marginBottom: 8 }}>
        <div className="cal-title">固定課表</div>
        <div className="spacer" />
        <button className="btn sm primary" onClick={() => setEditing('new')}>
          <IconPlus size={15} /> 新增
        </button>
      </div>

      <div className="banner info" style={{ marginBottom: 12 }}>
        <IconRepeat size={16} />
        <span>
          這裡設定「星期幾的哪個時段固定是哪一班」。設好之後，你在 AI 助理只要說日期，
          助理就會自動帶入班級、地點和課程；你另外講的內容一律優先。
        </span>
      </div>

      {data.patterns.length === 0 ? (
        <Empty icon="🔁" title="還沒有固定課表" sub="用助理排課時勾選「記成固定課表」，或按右上角新增" />
      ) : (
        <>
          {[1, 2, 3, 4, 5, 6, 0].map((wd) => {
            const rows = byDay.get(wd)
            if (!rows?.length) return null
            return (
              <div key={wd}>
                <div className="section-title">星期{WEEKDAY_ZH[wd]}</div>
                <div className="list">
                  {rows.map((p) => (
                    <button className="item" key={p.id} onClick={() => setEditing(p)}>
                      <div className="t">
                        <div className="n mono">{p.start_time}–{p.end_time}</div>
                        <div className="s">
                          {[data.nameOf.location(p.location_id), data.nameOf.course(p.course_id), data.nameOf.group(p.group_id)]
                            .filter(Boolean).join('・') || '（未指定內容）'}
                        </div>
                      </div>
                      {!p.active && <span className="chip">停用</span>}
                      <IconChevR size={17} className="chev" />
                    </button>
                  ))}
                </div>
              </div>
            )
          })}

          <button className="btn block" style={{ marginTop: 16 }} onClick={() => setGenerating(true)}>
            依固定課表批次產生課程
          </button>
        </>
      )}

      {editing && (
        <PatternSheet data={data} pattern={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />
      )}
      {generating && <GenerateSheet data={data} onClose={() => setGenerating(false)} />}
    </div>
  )
}

// ---------------------------------------------------------------------------

function PatternSheet({ data, pattern, onClose }: { data: AppData; pattern?: Pattern; onClose: () => void }) {
  const toast = useToast()
  const isNew = !pattern
  const [f, setF] = useState<Partial<Pattern>>(
    pattern ?? { weekday: 1, start_time: '14:00', end_time: '15:30', active: 1 },
  )
  const [confirmDel, setConfirmDel] = useState(false)
  const set = (p: Partial<Pattern>) => setF((x) => ({ ...x, ...p }))

  if (confirmDel && pattern) {
    return (
      <Confirm title="刪除這條固定課表？" body="已經排定的課程不會受影響。" confirmLabel="刪除" danger
        onConfirm={async () => { await remove('patterns', pattern.id); toast('已刪除'); onClose() }}
        onCancel={() => setConfirmDel(false)} />
    )
  }

  return (
    <Sheet
      title={isNew ? '新增固定課表' : '編輯固定課表'}
      onClose={onClose}
      footer={
        <>
          {!isNew && (
            <button className="btn danger" style={{ flex: '0 0 46px' }} onClick={() => setConfirmDel(true)} aria-label="刪除">
              <IconTrash size={18} />
            </button>
          )}
          <button className="btn" onClick={onClose}>取消</button>
          <button className="btn primary" onClick={async () => {
            const payload = {
              weekday: f.weekday ?? 1,
              start_time: f.start_time ?? '14:00',
              end_time: f.end_time ?? '15:30',
              location_id: f.location_id, course_id: f.course_id, group_id: f.group_id,
              active: f.active ?? 1, valid_from: f.valid_from, valid_to: f.valid_to,
            }
            if (isNew) await create<Pattern>('patterns', payload)
            else await update<Pattern>('patterns', pattern!.id, payload)
            toast('已儲存')
            onClose()
          }}>儲存</button>
        </>
      }
    >
      <Field label="星期">
        <div className="switch">
          {[1, 2, 3, 4, 5, 6, 0].map((wd) => (
            <button key={wd} className={f.weekday === wd ? 'on' : ''} onClick={() => set({ weekday: wd })}>
              {WEEKDAY_ZH[wd]}
            </button>
          ))}
        </div>
      </Field>

      <div className="grid2">
        <Field label="開始">
          <input className="input" type="time" value={f.start_time ?? ''}
            onChange={(e) => set({ start_time: e.target.value, end_time: addMinutes(e.target.value, 90) })} />
        </Field>
        <Field label="結束">
          <input className="input" type="time" value={f.end_time ?? ''} onChange={(e) => set({ end_time: e.target.value })} />
        </Field>
      </div>

      <Field label="地點">
        <select className="select" value={f.location_id ?? ''} onChange={(e) => set({ location_id: e.target.value || undefined })}>
          <option value="">（不指定）</option>
          {data.locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
      </Field>
      <Field label="課程">
        <select className="select" value={f.course_id ?? ''} onChange={(e) => set({ course_id: e.target.value || undefined })}>
          <option value="">（不指定）</option>
          {data.courses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </Field>
      <Field label="班級" hint="這是助理推斷的關鍵，建議一定要填">
        <select className="select" value={f.group_id ?? ''} onChange={(e) => set({ group_id: e.target.value || undefined })}>
          <option value="">（不指定）</option>
          {data.groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
        </select>
      </Field>

      <div className="grid2">
        <Field label="生效起（可留白）">
          <input className="input" type="date" value={f.valid_from ?? ''} onChange={(e) => set({ valid_from: e.target.value || undefined })} />
        </Field>
        <Field label="生效迄（可留白）">
          <input className="input" type="date" value={f.valid_to ?? ''} onChange={(e) => set({ valid_to: e.target.value || undefined })} />
        </Field>
      </div>

      <label className="row" style={{ gap: 8, cursor: 'pointer' }}>
        <input type="checkbox" checked={!!f.active} onChange={(e) => set({ active: e.target.checked ? 1 : 0 })}
          style={{ width: 17, height: 17, accentColor: 'var(--accent)' }} />
        <span className="small">啟用（停用後助理不會再參考這條）</span>
      </label>
    </Sheet>
  )
}

// ---------------------------------------------------------------------------

function GenerateSheet({ data, onClose }: { data: AppData; onClose: () => void }) {
  const toast = useToast()
  const today = todayStr()
  const [from, setFrom] = useState(today)
  const [to, setTo] = useState(endOfMonth(addDays(today, 60)))
  const [picked, setPicked] = useState<string[]>(data.patterns.filter((p) => p.active).map((p) => p.id))
  const [busy, setBusy] = useState(false)

  const preview = useMemo(() => {
    let n = 0
    for (const p of data.patterns) {
      if (!picked.includes(p.id)) continue
      n += expandRecurring({
        weekdays: [p.weekday],
        from: p.valid_from && p.valid_from > from ? p.valid_from : from,
        to: p.valid_to && p.valid_to < to ? p.valid_to : to,
      }).length
    }
    return n
  }, [data.patterns, picked, from, to])

  const run = async () => {
    setBusy(true)
    let made = 0
    let skipped = 0
    const pool = [...data.lessons]
    for (const p of data.patterns) {
      if (!picked.includes(p.id)) continue
      const dates = expandRecurring({
        weekdays: [p.weekday],
        from: p.valid_from && p.valid_from > from ? p.valid_from : from,
        to: p.valid_to && p.valid_to < to ? p.valid_to : to,
      })
      for (const date of dates) {
        if (findConflict(pool, date, p.start_time, p.end_time)) { skipped++; continue }
        const l = await create<Lesson>('lessons', {
          kind: 'class', guest_students: [],
          date, start_time: p.start_time, end_time: p.end_time,
          location_id: p.location_id, course_id: p.course_id, group_id: p.group_id,
          is_substitute: 0, status: 'planned', attendance: {}, pattern_id: p.id,
        })
        pool.push(l)
        made++
      }
    }
    setBusy(false)
    toast(`已產生 ${made} 堂${skipped ? `，略過 ${skipped} 堂重複時段` : ''}`)
    onClose()
  }

  return (
    <Sheet
      title="批次產生課程"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>取消</button>
          <button className="btn primary" onClick={run} disabled={busy || !picked.length}>
            {busy ? '產生中…' : `產生 ${preview} 堂`}
          </button>
        </>
      }
    >
      <div className="grid2">
        <Field label="從"><input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="到"><input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
      </div>
      <div className="small faint">已經有課的時段會自動略過，不會重複。</div>

      <div className="section-title">要產生哪幾條</div>
      <div className="list">
        {data.patterns.map((p) => (
          <label className="item" key={p.id} style={{ cursor: 'pointer' }}>
            <input type="checkbox" checked={picked.includes(p.id)}
              onChange={(e) => setPicked((x) => e.target.checked ? [...x, p.id] : x.filter((y) => y !== p.id))}
              style={{ width: 17, height: 17, accentColor: 'var(--accent)' }} />
            <div className="t">
              <div className="n">週{WEEKDAY_ZH[p.weekday]} <span className="mono">{p.start_time}–{p.end_time}</span></div>
              <div className="s">
                {[data.nameOf.location(p.location_id), data.nameOf.course(p.course_id), data.nameOf.group(p.group_id)]
                  .filter(Boolean).join('・')}
              </div>
            </div>
          </label>
        ))}
      </div>
      <div className="small faint">預計範圍：{formatDateZh(from)} ～ {formatDateZh(to)}</div>
    </Sheet>
  )
}

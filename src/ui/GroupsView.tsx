import { useState } from 'react'
import { create, latestTopicOfGroup, remove, update } from '../db/repo'
import type { Group, Student } from '../db/types'
import { formatDateZh } from '../lib/date'
import { Confirm, Empty, Field, Sheet, TagEditor, useToast } from './common'
import { IconChevR, IconPlus, IconTrash } from './icons'
import type { AppData } from './useData'

export function GroupsView({ data }: { data: AppData }) {
  const [editing, setEditing] = useState<Group | 'new' | null>(null)

  return (
    <div className="pad">
      <div className="row" style={{ marginBottom: 10 }}>
        <div className="cal-title">班級與學生</div>
        <div className="spacer" />
        <button className="btn sm primary" onClick={() => setEditing('new')}>
          <IconPlus size={15} /> 新增班級
        </button>
      </div>

      {data.groups.length === 0 ? (
        <Empty icon="👦" title="還沒有班級" sub="用 AI 助理排課時會自動建立，也可以在這裡手動加" />
      ) : (
        <div className="list">
          {data.groups.map((g) => {
            const kids = data.studentsOf(g.id)
            const prev = latestTopicOfGroup(g.id, data.lessons)
            const count = data.lessons.filter((l) => !l.deleted && l.group_id === g.id && l.status !== 'cancelled').length
            return (
              <button className="item" key={g.id} onClick={() => setEditing(g)}>
                <div className="t">
                  <div className="n">{g.name}</div>
                  <div className="s">
                    {kids.length} 位學生・{count} 堂課
                    {prev && <> ・上次 {formatDateZh(prev.date!)}「{prev.topic}」</>}
                  </div>
                </div>
                <IconChevR size={17} className="chev" />
              </button>
            )
          })}
        </div>
      )}

      {editing && (
        <GroupSheet
          data={data}
          group={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------

function GroupSheet({ data, group, onClose }: { data: AppData; group?: Group; onClose: () => void }) {
  const toast = useToast()
  const isNew = !group
  const [name, setName] = useState(group?.name ?? '')
  const [aliases, setAliases] = useState<string[]>(group?.aliases ?? [])
  const [note, setNote] = useState(group?.note ?? '')
  const [locId, setLocId] = useState(group?.default_location_id)
  const [couId, setCouId] = useState(group?.default_course_id)
  const [newStudent, setNewStudent] = useState('')
  const [confirmDel, setConfirmDel] = useState(false)
  const [renaming, setRenaming] = useState<Student | null>(null)

  const students = group ? data.studentsOf(group.id) : []
  const prev = group ? latestTopicOfGroup(group.id, data.lessons) : null

  const save = async () => {
    if (!name.trim()) { toast('請填班級名稱'); return }
    const payload = {
      name: name.trim(), aliases, note: note.trim() || undefined,
      default_location_id: locId, default_course_id: couId,
    }
    if (isNew) await create<Group>('groups', payload)
    else await update<Group>('groups', group!.id, payload)
    toast(isNew ? '已新增班級' : '已更新')
    onClose()
  }

  const addStudent = async () => {
    const n = newStudent.trim()
    if (!n) return
    let gid = group?.id
    if (!gid) {
      if (!name.trim()) { toast('請先填班級名稱'); return }
      const g = await create<Group>('groups', { name: name.trim(), aliases })
      gid = g.id
    }
    // 一次貼多個名字：用空白、逗號、頓號分隔
    const names = n.split(/[\s,，、;；\n]+/).map((x) => x.trim()).filter(Boolean)
    for (const nm of names) {
      await create<Student>('students', { group_id: gid, name: nm, active: 1 })
    }
    setNewStudent('')
    toast(`已加入 ${names.length} 位`)
  }

  if (confirmDel && group) {
    return (
      <Confirm
        title={`刪除「${group.name}」？`}
        body="班級底下的學生也會一起刪除。已排定的課程會保留，但班級欄位會變成空白。"
        confirmLabel="刪除" danger
        onConfirm={async () => {
          for (const s of students) await remove('students', s.id)
          await remove('groups', group.id)
          toast('已刪除')
          onClose()
        }}
        onCancel={() => setConfirmDel(false)}
      />
    )
  }

  if (renaming) {
    return (
      <RenameStudent student={renaming} onDone={() => setRenaming(null)} />
    )
  }

  return (
    <Sheet
      title={isNew ? '新增班級' : group!.name}
      onClose={onClose}
      footer={
        <>
          {!isNew && (
            <button className="btn danger" style={{ flex: '0 0 46px' }} onClick={() => setConfirmDel(true)} aria-label="刪除">
              <IconTrash size={18} />
            </button>
          )}
          <button className="btn" onClick={onClose}>取消</button>
          <button className="btn primary" onClick={save}>儲存</button>
        </>
      }
    >
      {prev && (
        <div className="banner ok">
          <span>最近進度：{formatDateZh(prev.date!)}「{prev.topic}」</span>
        </div>
      )}

      <Field label="班級名稱">
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：學生組B" />
      </Field>

      <Field label="別名" hint="你講話時可能會用到的其他叫法，AI 助理會一起比對">
        <TagEditor values={aliases} onChange={setAliases} placeholder="例如：B組" />
      </Field>

      <div className="grid2">
        <Field label="常用地點">
          <select className="select" value={locId ?? ''} onChange={(e) => setLocId(e.target.value || undefined)}>
            <option value="">（不指定）</option>
            {data.locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </Field>
        <Field label="常用課程">
          <select className="select" value={couId ?? ''} onChange={(e) => setCouId(e.target.value || undefined)}>
            <option value="">（不指定）</option>
            {data.courses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
      </div>

      <Field label="備註">
        <textarea className="textarea" style={{ minHeight: 54 }} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>

      <hr className="sep" />

      <div className="row">
        <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-dim)' }}>學生名單</div>
        <div className="spacer" />
        <span className="chip">{students.length} 位</span>
      </div>

      {students.length > 0 && (
        <div className="list">
          {students.map((s) => (
            <div className="item" key={s.id} style={{ cursor: 'default' }}>
              <div className="t">
                <div className="n">{s.name}</div>
                {s.note && <div className="s">{s.note}</div>}
              </div>
              <button className="btn ghost sm" onClick={() => setRenaming(s)}>改名</button>
              <button className="btn ghost sm danger" onClick={async () => { await remove('students', s.id) }} aria-label="移除">
                <IconTrash size={15} />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="row" style={{ gap: 7 }}>
        <input
          className="input"
          value={newStudent}
          placeholder="輸入姓名，可一次貼多個（用空白或逗號隔開）"
          onChange={(e) => setNewStudent(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); addStudent() } }}
        />
        <button className="btn primary" onClick={addStudent} style={{ flex: '0 0 auto' }}>加入</button>
      </div>
    </Sheet>
  )
}

function RenameStudent({ student, onDone }: { student: Student; onDone: () => void }) {
  const [name, setName] = useState(student.name)
  const [note, setNote] = useState(student.note ?? '')
  return (
    <Sheet
      title="編輯學生"
      onClose={onDone}
      footer={
        <>
          <button className="btn" onClick={onDone}>取消</button>
          <button className="btn primary" onClick={async () => {
            if (name.trim()) await update<Student>('students', student.id, { name: name.trim(), note: note.trim() || undefined })
            onDone()
          }}>儲存</button>
        </>
      }
    >
      <Field label="姓名">
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
      </Field>
      <Field label="備註">
        <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="例如：對顏色敏感、需要提醒帶課本" />
      </Field>
    </Sheet>
  )
}

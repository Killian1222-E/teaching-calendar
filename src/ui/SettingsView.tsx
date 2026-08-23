import { useEffect, useState } from 'react'
import { db, getSettings, saveSettings } from '../db/local'
import { create, pickColor, remove, update } from '../db/repo'
import {
  currentSession, pendingCount, pullEverything, pushEverything, resetClient,
  signIn, signOut, signUp, triggerSync,
} from '../db/sync'
import { TABLES, type Course, type Location } from '../db/types'
import { Confirm, Empty, Field, Sheet, TagEditor, useToast } from './common'
import { IconChevR, IconCloud, IconPlus, IconSync, IconTrash } from './icons'
import type { AppData } from './useData'

export function SettingsView({ data }: { data: AppData }) {
  const toast = useToast()
  const [panel, setPanel] = useState<'cloud' | 'ai' | 'places' | 'courses' | 'backup' | null>(null)
  const [email, setEmail] = useState<string | null>(null)
  const [pending, setPending] = useState(0)

  const refresh = async () => {
    const s = await currentSession()
    setEmail(s?.user.email ?? null)
    setPending(await pendingCount())
  }
  useEffect(() => { refresh() }, [data.lessons.length, panel])

  const cloudConfigured = !!(data.settings?.supabase_url && data.settings?.supabase_anon_key)

  return (
    <div className="pad">
      <div className="cal-title" style={{ marginBottom: 12 }}>設定</div>

      <div className="section-title">同步</div>
      <div className="list">
        <button className="item" onClick={() => setPanel('cloud')}>
          <IconCloud size={19} />
          <div className="t">
            <div className="n">雲端同步</div>
            <div className="s">
              {!cloudConfigured ? '尚未設定 — 目前只存在這台裝置'
                : email ? `已登入 ${email}${pending ? `・${pending} 筆待上傳` : '・已是最新'}`
                : '已設定，但尚未登入'}
            </div>
          </div>
          <IconChevR size={17} className="chev" />
        </button>
        {cloudConfigured && email && (
          <button className="item" onClick={async () => {
            const out = await triggerSync()
            toast(out.error ? `同步失敗：${out.error}` : `同步完成（上傳 ${out.pushed}、下載 ${out.pulled}）`)
            refresh()
          }}>
            <IconSync size={19} />
            <div className="t"><div className="n">立即同步</div></div>
          </button>
        )}
      </div>

      <div className="section-title">助理</div>
      <div className="list">
        <button className="item" onClick={() => setPanel('ai')}>
          <div className="t">
            <div className="n">AI 備援</div>
            <div className="s">
              {data.settings?.ai_provider && data.settings.ai_provider !== 'none' && data.settings.ai_api_key
                ? `已啟用（${data.settings.ai_provider === 'anthropic' ? 'Claude' : 'OpenAI'}）`
                : '未啟用 — 只用內建規則解析'}
            </div>
          </div>
          <IconChevR size={17} className="chev" />
        </button>
      </div>

      <div className="section-title">基本資料</div>
      <div className="list">
        <button className="item" onClick={() => setPanel('places')}>
          <div className="t"><div className="n">上課地點</div><div className="s">{data.locations.length} 個</div></div>
          <IconChevR size={17} className="chev" />
        </button>
        <button className="item" onClick={() => setPanel('courses')}>
          <div className="t"><div className="n">課程種類</div><div className="s">{data.courses.length} 種</div></div>
          <IconChevR size={17} className="chev" />
        </button>
      </div>

      <div className="section-title">外觀</div>
      <div className="card pad">
        <div className="switch">
          {(['system', 'light', 'dark'] as const).map((t) => (
            <button key={t} className={(data.settings?.theme ?? 'system') === t ? 'on' : ''}
              onClick={async () => { await saveSettings({ theme: t }); applyTheme(t) }}>
              {t === 'system' ? '跟隨系統' : t === 'light' ? '淺色' : '深色'}
            </button>
          ))}
        </div>
      </div>

      <div className="section-title">其他</div>
      <div className="list">
        <button className="item" onClick={() => setPanel('backup')}>
          <div className="t"><div className="n">備份與還原</div><div className="s">匯出 / 匯入 JSON 檔</div></div>
          <IconChevR size={17} className="chev" />
        </button>
      </div>

      <div className="center tiny faint" style={{ padding: '26px 0 10px' }}>
        課程行事曆 v1.0・資料先存在本機，設定雲端後才會同步
      </div>

      {panel === 'cloud' && <CloudSheet data={data} onClose={() => { setPanel(null); refresh() }} />}
      {panel === 'ai' && <AISheet data={data} onClose={() => setPanel(null)} />}
      {panel === 'places' && <PlacesSheet data={data} onClose={() => setPanel(null)} />}
      {panel === 'courses' && <CoursesSheet data={data} onClose={() => setPanel(null)} />}
      {panel === 'backup' && <BackupSheet onClose={() => setPanel(null)} />}
    </div>
  )
}

export function applyTheme(t: 'system' | 'light' | 'dark') {
  const root = document.documentElement
  if (t === 'system') root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', t)
}

// ---------------------------------------------------------------------------

function CloudSheet({ data, onClose }: { data: AppData; onClose: () => void }) {
  const toast = useToast()
  const [url, setUrl] = useState(data.settings?.supabase_url ?? '')
  const [key, setKey] = useState(data.settings?.supabase_anon_key ?? '')
  const [email, setEmail] = useState('')
  const [pw, setPw] = useState('')
  const [session, setSession] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err' | 'info'; text: string } | null>(null)

  const refresh = async () => {
    const s = await currentSession()
    setSession(s?.user.email ?? null)
  }
  useEffect(() => { refresh() }, [])

  const saveConn = async () => {
    await saveSettings({ supabase_url: url.trim().replace(/\/+$/, ''), supabase_anon_key: key.trim() })
    resetClient()
    setMsg({ kind: 'ok', text: '連線資訊已儲存，接著登入或註冊。' })
  }

  const run = async (fn: () => Promise<any>, okText: string) => {
    setBusy(true); setMsg(null)
    try {
      const r = await fn()
      setMsg({ kind: 'ok', text: typeof r === 'string' ? r : okText })
      await refresh()
    } catch (e: any) {
      setMsg({ kind: 'err', text: e.message })
    } finally { setBusy(false) }
  }

  return (
    <Sheet title="雲端同步" onClose={onClose}
      footer={<button className="btn primary block" onClick={onClose}>完成</button>}>
      <div className="banner info">
        <span>
          到 supabase.com 開一個免費專案，把 Project URL 和 anon public key 貼進來，
          再用同一組帳號在電腦和手機登入，兩邊就會自動同步。
          第一次使用要先在 Supabase 的 SQL Editor 執行專案附的 <b>supabase/schema.sql</b>。
        </span>
      </div>

      <Field label="Project URL">
        <input className="input" value={url} onChange={(e) => setUrl(e.target.value)}
          placeholder="https://xxxxxxxx.supabase.co" autoCapitalize="off" spellCheck={false} />
      </Field>
      <Field label="anon public key">
        <input className="input" value={key} onChange={(e) => setKey(e.target.value)}
          placeholder="eyJhbGciOi..." autoCapitalize="off" spellCheck={false} />
      </Field>
      <button className="btn" onClick={saveConn}>儲存連線資訊</button>

      <hr className="sep" />

      {session ? (
        <>
          <div className="banner ok"><span>已登入：{session}</span></div>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn" style={{ flex: 1 }} disabled={busy}
              onClick={() => run(async () => {
                const o = await triggerSync()
                if (o.error) throw new Error(o.error)
                return `同步完成（上傳 ${o.pushed}、下載 ${o.pulled}）`
              }, '同步完成')}>立即同步</button>
            <button className="btn" style={{ flex: 1 }} disabled={busy}
              onClick={() => run(async () => {
                const o = await pushEverything()
                if (o.error) throw new Error(o.error)
                return `已上傳 ${o.pushed} 筆`
              }, '上傳完成')}>全部上傳</button>
          </div>
          <button className="btn block" disabled={busy}
            onClick={() => run(async () => {
              const o = await pullEverything()
              if (o.error) throw new Error(o.error)
              return `已下載 ${o.pulled} 筆`
            }, '下載完成')}>從雲端重新下載（新裝置用）</button>
          <button className="btn danger block" disabled={busy}
            onClick={() => run(async () => { await signOut(); return '已登出' }, '已登出')}>登出</button>
        </>
      ) : (
        <>
          <Field label="Email">
            <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)}
              autoCapitalize="off" spellCheck={false} />
          </Field>
          <Field label="密碼" hint="至少 6 碼">
            <input className="input" type="password" value={pw} onChange={(e) => setPw(e.target.value)} />
          </Field>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn primary" style={{ flex: 1 }} disabled={busy || !email || !pw}
              onClick={() => run(async () => { await signIn(email, pw); await triggerSync(); return '登入成功' }, '登入成功')}>
              登入
            </button>
            <button className="btn" style={{ flex: 1 }} disabled={busy || !email || !pw}
              onClick={() => run(() => signUp(email, pw), '註冊完成')}>註冊</button>
          </div>
        </>
      )}

      {msg && <div className={'banner ' + (msg.kind === 'err' ? 'err' : msg.kind === 'ok' ? 'ok' : 'info')}>
        <span>{msg.text}</span>
      </div>}
      {busy && <div className="row small muted"><IconSync size={15} className="spin" /> 處理中…</div>}
      <div className="tiny faint" onClick={() => toast('提示：手機和電腦要用同一組帳號登入')}>
        資料只會存在你自己的 Supabase 專案，沒有經過任何第三方伺服器。
      </div>
    </Sheet>
  )
}

// ---------------------------------------------------------------------------

function AISheet({ data, onClose }: { data: AppData; onClose: () => void }) {
  const toast = useToast()
  const [provider, setProvider] = useState(data.settings?.ai_provider ?? 'none')
  const [apiKey, setApiKey] = useState(data.settings?.ai_api_key ?? '')
  const [model, setModel] = useState(data.settings?.ai_model ?? 'claude-sonnet-4-5-20250929')

  return (
    <Sheet title="AI 備援" onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>取消</button>
          <button className="btn primary" onClick={async () => {
            await saveSettings({
              ai_provider: provider as any,
              ai_api_key: apiKey.trim() || undefined,
              ai_model: model.trim() || undefined,
            })
            toast('已儲存')
            onClose()
          }}>儲存</button>
        </>
      }>
      <div className="banner info">
        <span>
          內建的中文解析器可以處理絕大多數排課句子，而且完全離線、不花錢。
          只有在它看不懂的時候，才會把句子送給 AI。不填 key 也能正常使用。
        </span>
      </div>

      <Field label="服務商">
        <div className="switch">
          {(['none', 'anthropic', 'openai'] as const).map((p) => (
            <button key={p} className={provider === p ? 'on' : ''} onClick={() => {
              setProvider(p)
              if (p === 'anthropic') setModel('claude-sonnet-4-5-20250929')
              if (p === 'openai') setModel('gpt-4o-mini')
            }}>
              {p === 'none' ? '不使用' : p === 'anthropic' ? 'Claude' : 'OpenAI'}
            </button>
          ))}
        </div>
      </Field>

      {provider !== 'none' && (
        <>
          <Field label="API key" hint="只存在這台裝置，不會同步到雲端">
            <input className="input" type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)}
              placeholder={provider === 'anthropic' ? 'sk-ant-...' : 'sk-...'}
              autoCapitalize="off" spellCheck={false} />
          </Field>
          <Field label="模型">
            <input className="input" value={model} onChange={(e) => setModel(e.target.value)}
              autoCapitalize="off" spellCheck={false} />
          </Field>
        </>
      )}
    </Sheet>
  )
}

// ---------------------------------------------------------------------------

function PlacesSheet({ data, onClose }: { data: AppData; onClose: () => void }) {
  const toast = useToast()
  const [name, setName] = useState('')
  const [del, setDel] = useState<Location | null>(null)

  if (del) {
    return <Confirm title={`刪除「${del.name}」？`} body="已排定課程的地點欄位會變成空白。" confirmLabel="刪除" danger
      onConfirm={async () => { await remove('locations', del.id); setDel(null); toast('已刪除') }}
      onCancel={() => setDel(null)} />
  }

  return (
    <Sheet title="上課地點" onClose={onClose} footer={<button className="btn primary block" onClick={onClose}>完成</button>}>
      {data.locations.length === 0 && <Empty icon="📍" title="還沒有地點" sub="排課時會自動建立" />}
      <div className="list">
        {data.locations.map((l) => (
          <div className="item" key={l.id} style={{ cursor: 'default' }}>
            <span className="swatch" style={{ background: l.color }} />
            <div className="t">
              <input className="input" style={{ border: 0, background: 'none', padding: 0, fontSize: 14.5, fontWeight: 580 }}
                defaultValue={l.name}
                onBlur={async (e) => {
                  const v = e.target.value.trim()
                  if (v && v !== l.name) { await update<Location>('locations', l.id, { name: v }); toast('已更新') }
                }} />
            </div>
            <button className="btn ghost sm danger" onClick={() => setDel(l)} aria-label="刪除"><IconTrash size={15} /></button>
          </div>
        ))}
      </div>
      <div className="row" style={{ gap: 7 }}>
        <input className="input" value={name} placeholder="新增地點，例如：三民分校"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={async (e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing && name.trim()) {
              await create<Location>('locations', { name: name.trim(), color: pickColor(data.locations.length) })
              setName('')
            }
          }} />
        <button className="btn primary" style={{ flex: '0 0 auto' }} disabled={!name.trim()}
          onClick={async () => {
            await create<Location>('locations', { name: name.trim(), color: pickColor(data.locations.length) })
            setName('')
          }}><IconPlus size={16} /></button>
      </div>
    </Sheet>
  )
}

function CoursesSheet({ data, onClose }: { data: AppData; onClose: () => void }) {
  const toast = useToast()
  const [name, setName] = useState('')
  const [editing, setEditing] = useState<Course | null>(null)
  const [del, setDel] = useState<Course | null>(null)

  if (del) {
    return <Confirm title={`刪除「${del.name}」？`} confirmLabel="刪除" danger
      onConfirm={async () => { await remove('courses', del.id); setDel(null); toast('已刪除') }}
      onCancel={() => setDel(null)} />
  }

  if (editing) {
    return <CourseEdit course={editing} onClose={() => setEditing(null)} />
  }

  return (
    <Sheet title="課程種類" onClose={onClose} footer={<button className="btn primary block" onClick={onClose}>完成</button>}>
      {data.courses.length === 0 && <Empty icon="📚" title="還沒有課程" sub="排課時會自動建立" />}
      <div className="list">
        {data.courses.map((c) => (
          <button className="item" key={c.id} onClick={() => setEditing(c)}>
            <span className="swatch" style={{ background: c.color }} />
            <div className="t">
              <div className="n">{c.name}</div>
              {c.aliases.length > 0 && <div className="s">別名：{c.aliases.join('、')}</div>}
            </div>
            <span className="btn ghost sm danger" onClick={(e) => { e.stopPropagation(); setDel(c) }}>
              <IconTrash size={15} />
            </span>
          </button>
        ))}
      </div>
      <div className="row" style={{ gap: 7 }}>
        <input className="input" value={name} placeholder="新增課程，例如：樂高教育"
          onChange={(e) => setName(e.target.value)} />
        <button className="btn primary" style={{ flex: '0 0 auto' }} disabled={!name.trim()}
          onClick={async () => {
            await create<Course>('courses', { name: name.trim(), aliases: [], color: pickColor(data.courses.length + 3) })
            setName('')
          }}><IconPlus size={16} /></button>
      </div>
    </Sheet>
  )
}

function CourseEdit({ course, onClose }: { course: Course; onClose: () => void }) {
  const toast = useToast()
  const [name, setName] = useState(course.name)
  const [aliases, setAliases] = useState(course.aliases)
  const [color, setColor] = useState(course.color)
  return (
    <Sheet title="編輯課程" onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>取消</button>
          <button className="btn primary" onClick={async () => {
            await update<Course>('courses', course.id, { name: name.trim(), aliases, color })
            toast('已儲存')
            onClose()
          }}>儲存</button>
        </>
      }>
      <Field label="名稱"><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <Field label="別名" hint="你講話會用到的簡稱，例如 MC、麥塊">
        <TagEditor values={aliases} onChange={setAliases} />
      </Field>
      <Field label="顏色">
        <input type="color" className="input" style={{ height: 44, padding: 4 }} value={color}
          onChange={(e) => setColor(e.target.value)} />
      </Field>
    </Sheet>
  )
}

// ---------------------------------------------------------------------------

function BackupSheet({ onClose }: { onClose: () => void }) {
  const toast = useToast()
  const [busy, setBusy] = useState(false)

  const exportAll = async () => {
    setBusy(true)
    const dump: any = { version: 1, exported_at: new Date().toISOString() }
    for (const t of TABLES) dump[t] = await (db as any)[t].toArray()
    const blob = new Blob([JSON.stringify(dump, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `課表備份-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(a.href)
    setBusy(false)
    toast('已下載備份檔')
  }

  const importAll = async (file: File) => {
    setBusy(true)
    try {
      const dump = JSON.parse(await file.text())
      let n = 0
      for (const t of TABLES) {
        const rows = dump[t]
        if (!Array.isArray(rows)) continue
        await (db as any)[t].bulkPut(rows.map((r: any) => ({ ...r, dirty: 1 })))
        n += rows.length
      }
      await saveSettings({ last_pull_at: undefined })
      toast(`已匯入 ${n} 筆`)
      onClose()
    } catch (e: any) {
      toast('匯入失敗：' + e.message)
    } finally { setBusy(false) }
  }

  return (
    <Sheet title="備份與還原" onClose={onClose} footer={<button className="btn block" onClick={onClose}>關閉</button>}>
      <button className="btn block" onClick={exportAll} disabled={busy}>匯出全部資料（JSON）</button>
      <label className="btn block" style={{ cursor: 'pointer' }}>
        匯入備份檔
        <input type="file" accept="application/json,.json" hidden
          onChange={(e) => { const f = e.target.files?.[0]; if (f) importAll(f) }} />
      </label>
      <div className="banner warn">
        <span>匯入會用備份檔的內容覆蓋同 ID 的資料。如果有開雲端同步，匯入後記得按「全部上傳」。</span>
      </div>
      <hr className="sep" />
      <ResetBlock />
    </Sheet>
  )
}

function ResetBlock() {
  const toast = useToast()
  const [ask, setAsk] = useState(false)
  if (ask) {
    return (
      <Confirm title="清空這台裝置的資料？" danger confirmLabel="清空"
        body="只會清掉本機資料庫。若已同步到雲端，可以再從雲端重新下載回來。"
        onConfirm={async () => {
          for (const t of TABLES) await (db as any)[t].clear()
          await saveSettings({ last_pull_at: undefined })
          setAsk(false)
          toast('已清空')
        }}
        onCancel={() => setAsk(false)} />
    )
  }
  return <button className="btn danger block" onClick={() => setAsk(true)}>清空本機資料</button>
}

export { getSettings }

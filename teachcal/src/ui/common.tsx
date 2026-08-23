import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { IconX } from './icons'

// ---------------------------------------------------------------------------
// Toast
// ---------------------------------------------------------------------------
const ToastCtx = createContext<(msg: string) => void>(() => {})
export const useToast = () => useContext(ToastCtx)

export function ToastHost({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState<string | null>(null)
  const show = useCallback((m: string) => setMsg(m), [])
  useEffect(() => {
    if (!msg) return
    const t = setTimeout(() => setMsg(null), 2600)
    return () => clearTimeout(t)
  }, [msg])
  return (
    <ToastCtx.Provider value={show}>
      {children}
      {msg && <div className="toast" role="status">{msg}</div>}
    </ToastCtx.Provider>
  )
}

// ---------------------------------------------------------------------------
// 底部彈出面板
// ---------------------------------------------------------------------------
export function Sheet({
  title, onClose, children, footer,
}: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', h)
      document.body.style.overflow = ''
    }
  }, [onClose])
  return (
    <div className="sheet-wrap" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title}>
        <div className="sheet-head">
          <h2>{title}</h2>
          <button className="btn icon ghost" onClick={onClose} aria-label="關閉"><IconX size={19} /></button>
        </div>
        <div className="sheet-body">{children}</div>
        {footer && <div className="sheet-foot">{footer}</div>}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// 表單欄位
// ---------------------------------------------------------------------------
export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <div className="field">
      <label>{label}</label>
      {children}
      {hint && <div className="tiny faint">{hint}</div>}
    </div>
  )
}

export function Select<T extends { id: string; name: string }>({
  value, onChange, options, placeholder = '（不指定）',
}: { value?: string; onChange: (v: string | undefined) => void; options: T[]; placeholder?: string }) {
  return (
    <select className="select" value={value ?? ''} onChange={(e) => onChange(e.target.value || undefined)}>
      <option value="">{placeholder}</option>
      {options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
    </select>
  )
}

/** 可以新增/刪除的字串清單（別名編輯用） */
export function TagEditor({
  values, onChange, placeholder,
}: { values: string[]; onChange: (v: string[]) => void; placeholder?: string }) {
  const [draft, setDraft] = useState('')
  const add = () => {
    const v = draft.trim()
    if (v && !values.includes(v)) onChange([...values, v])
    setDraft('')
  }
  return (
    <div className="tag-input">
      {values.map((v) => (
        <span className="tag" key={v}>
          {v}
          <button onClick={() => onChange(values.filter((x) => x !== v))} aria-label={`移除 ${v}`}>×</button>
        </span>
      ))}
      <input
        className="input"
        style={{ flex: '1 1 120px', minWidth: 110, padding: '6px 9px', fontSize: 13.5 }}
        value={draft}
        placeholder={placeholder ?? '新增後按 Enter'}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add() } }}
        onBlur={add}
      />
    </div>
  )
}

export function Confirm({
  title, body, confirmLabel = '確定', danger, onConfirm, onCancel,
}: {
  title: string; body?: string; confirmLabel?: string; danger?: boolean
  onConfirm: () => void; onCancel: () => void
}) {
  return (
    <Sheet
      title={title}
      onClose={onCancel}
      footer={
        <>
          <button className="btn" onClick={onCancel}>取消</button>
          <button className={'btn ' + (danger ? 'danger' : 'primary')} onClick={onConfirm}>{confirmLabel}</button>
        </>
      }
    >
      {body && <p className="muted" style={{ margin: 0, lineHeight: 1.6 }}>{body}</p>}
    </Sheet>
  )
}

export function Empty({ icon, title, sub }: { icon: string; title: string; sub?: string }) {
  return (
    <div className="empty">
      <span className="big">{icon}</span>
      <div style={{ fontWeight: 600, color: 'var(--text-dim)' }}>{title}</div>
      {sub && <div className="small" style={{ marginTop: 4 }}>{sub}</div>}
    </div>
  )
}

/** 「推斷」徽章 */
export function SourceBadge({ source }: { source?: 'stated' | 'pattern' | 'default' }) {
  if (source === 'pattern') return <span className="chip accent">固定課表推斷</span>
  if (source === 'default') return <span className="chip warn">預設值</span>
  return null
}

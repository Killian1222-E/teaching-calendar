import { useEffect, useRef, useState } from 'react'
import { aiAvailable, parseWithAI, type AIConfig } from '../nlp/ai'
import { applyResult } from '../nlp/apply'
import { parse } from '../nlp/parse'
import type { LessonDraft, ParseResult } from '../nlp/types'
import { formatDateZh } from '../lib/date'
import { useToast } from './common'
import { IconSend, IconSparkle, IconSync, IconWarn } from './icons'
import type { AppData } from './useData'

type Msg =
  | { role: 'me'; text: string }
  | { role: 'bot'; text: string; error?: boolean }
  | { role: 'proposal'; result: ParseResult; applied?: boolean }

const SUGGESTIONS = [
  '8/25 1300-1430 三民分校 Minecraft 學生組B、不是代課，上次Minecraft 狗狗圍欄',
  '下週一一樣的課',
  '9月每週三 1600-1730 樂高 學生組A',
  '9/20 0900-1600 中鋼大活動 80人',
  '9/8 三民分校 代課 6個學生',
  '這週有哪些課',
  '學生組B上次上到哪',
]

export function AssistantView({ data }: { data: AppData }) {
  const toast = useToast()
  const [msgs, setMsgs] = useState<Msg[]>([
    {
      role: 'bot',
      text:
        '用一句話告訴我要排什麼課就好，例如：\n\n「8/25 1300-1430 三民分校 Minecraft 學生組B、不是代課，上次Minecraft 狗狗圍欄」\n\n' +
        '我會自己拆成日期、時間、地點、課程、班級。之後同一個星期幾、同一個時段，我就直接幫你帶入同一個班級，除非你另外說有變動。\n\n' +
        '代課、大活動也可以直接講，例如「9/20 0900-1600 中鋼大活動 80人」。同一班每週上不同課時，沒講課程我會提醒你，不會自己亂猜。',
    },
  ])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [learnPatterns, setLearnPatterns] = useState(true)
  const endRef = useRef<HTMLDivElement>(null)
  const taRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [msgs, busy])

  const aiCfg: AIConfig = {
    provider: data.settings?.ai_provider ?? 'none',
    apiKey: data.settings?.ai_api_key,
    model: data.settings?.ai_model,
  }

  const send = async (raw?: string) => {
    const text = (raw ?? input).trim()
    if (!text || busy) return
    setInput('')
    if (taRef.current) taRef.current.style.height = 'auto'
    setMsgs((m) => [...m, { role: 'me', text }])
    setBusy(true)
    try {
      let result = parse(text, data.ctx)

      if (result.needsAI && aiAvailable(aiCfg)) {
        try {
          const ai = await parseWithAI(text, data.ctx, aiCfg)
          if (ai.drafts.length || ai.answer || ai.cancels.length || ai.reschedules.length) result = ai
        } catch (e: any) {
          setMsgs((m) => [...m, { role: 'bot', text: `AI 呼叫失敗：${e.message}\n先用內建解析的結果。`, error: true }])
        }
      }

      if (result.answer) {
        setMsgs((m) => [...m, { role: 'bot', text: result.answer! }])
      } else if (result.drafts.length || result.cancels.length || result.reschedules.length) {
        setMsgs((m) => [...m, { role: 'proposal', result }])
      } else {
        const hint = result.needsAI && !aiAvailable(aiCfg)
          ? '\n\n（到「設定」填入 AI API key，遇到看不懂的句子時我就能問 AI。）'
          : ''
        setMsgs((m) => [
          ...m,
          {
            role: 'bot',
            error: true,
            text: (result.warnings.join('\n') || '看不懂這句話。') +
              (result.unresolved.length ? `\n沒認出來的部分：${result.unresolved.join('、')}` : '') + hint,
          },
        ])
      }
    } finally {
      setBusy(false)
    }
  }

  const applyProposal = async (idx: number) => {
    const m = msgs[idx]
    if (m.role !== 'proposal' || m.applied) return
    const report = await applyResult(m.result, { learnPatterns, backfillPrevTopic: true })
    setMsgs((prev) => {
      const next = [...prev]
      next[idx] = { ...m, applied: true }
      const bits: string[] = []
      if (report.created.length) bits.push(`已加入 ${report.created.length} 堂課`)
      if (report.cancelled.length) bits.push(`已停課 ${report.cancelled.length} 堂`)
      if (report.rescheduled.length) bits.push(`已改期 ${report.rescheduled.length} 堂`)
      if (report.learnedPatterns) bits.push(`新增 ${report.learnedPatterns} 條固定課表`)
      next.push({ role: 'bot', text: bits.join('，') + '。' + (report.messages.join(' ') || '') })
      return next
    })
    toast('已寫入行事曆')
  }

  const dropDraft = (idx: number, di: number) => {
    setMsgs((prev) => {
      const m = prev[idx]
      if (m.role !== 'proposal') return prev
      const next = [...prev]
      const drafts = m.result.drafts.filter((_, i) => i !== di)
      next[idx] = { ...m, result: { ...m.result, drafts } }
      return next
    })
  }

  return (
    <>
      <div className="chat">
        {msgs.map((m, i) => {
          if (m.role === 'me') return <div key={i} className="bubble me">{m.text}</div>
          if (m.role === 'bot') return <div key={i} className={'bubble bot' + (m.error ? ' err' : '')}>{m.text}</div>
          return (
            <ProposalCard
              key={i}
              result={m.result}
              data={data}
              applied={!!m.applied}
              learnPatterns={learnPatterns}
              setLearnPatterns={setLearnPatterns}
              onApply={() => applyProposal(i)}
              onDrop={(di) => dropDraft(i, di)}
            />
          )
        })}
        {busy && (
          <div className="bubble bot row" style={{ gap: 8 }}>
            <IconSync size={16} className="spin" /> 解析中…
          </div>
        )}
        <div ref={endRef} />
      </div>

      <div className="suggests">
        {SUGGESTIONS.map((s) => (
          <button key={s} onClick={() => send(s)} disabled={busy}>{s}</button>
        ))}
      </div>

      <div className="composer">
        <textarea
          ref={taRef}
          value={input}
          rows={1}
          placeholder="用一句話說要排什麼課…"
          onChange={(e) => {
            setInput(e.target.value)
            e.target.style.height = 'auto'
            e.target.style.height = Math.min(130, e.target.scrollHeight) + 'px'
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              send()
            }
          }}
        />
        <button className="send" onClick={() => send()} disabled={busy || !input.trim()} aria-label="送出">
          <IconSend size={19} />
        </button>
      </div>
    </>
  )
}

// ---------------------------------------------------------------------------

function ProposalCard({
  result, data, applied, onApply, onDrop, learnPatterns, setLearnPatterns,
}: {
  result: ParseResult; data: AppData; applied: boolean
  onApply: () => void; onDrop: (i: number) => void
  learnPatterns: boolean; setLearnPatterns: (v: boolean) => void
}) {
  const isCreate = result.drafts.length > 0
  const title = isCreate
    ? `準備新增 ${result.drafts.length} 堂課`
    : result.cancels.length
      ? `準備停掉 ${result.cancels.length} 堂課`
      : `準備改期 ${result.reschedules.length} 堂課`

  const newThings = [
    ...new Set(result.drafts.flatMap((d) => [...d.creates.locations, ...d.creates.courses, ...d.creates.groups])),
  ]

  return (
    <div className="proposal">
      <div className="p-head">
        <IconSparkle size={16} />
        {title}
        <span className="spacer" />
        <span className="chip">{result.source === 'ai' ? 'AI' : '內建解析'}</span>
      </div>

      {result.warnings.map((w, i) => (
        <div key={i} className="banner warn" style={{ margin: '10px 13px 0', borderRadius: 8 }}>
          <IconWarn size={15} /> <span>{w}</span>
        </div>
      ))}

      {newThings.length > 0 && (
        <div className="banner info" style={{ margin: '10px 13px 0', borderRadius: 8 }}>
          <span>會一併建立：{newThings.join('、')}</span>
        </div>
      )}

      <div className="p-list">
        {result.drafts.map((d, i) => (
          <DraftRow key={i} d={d} data={data} onDrop={() => onDrop(i)} disabled={applied} />
        ))}
        {result.cancels.map((c, i) => (
          <div className="p-item" key={'c' + i}>
            <div className="p-main">
              <div style={{ fontWeight: 600 }}>{formatDateZh(c.lesson.date)} {c.lesson.start_time}–{c.lesson.end_time}</div>
              <div className="tiny faint">
                {[data.nameOf.course(c.lesson.course_id), data.nameOf.group(c.lesson.group_id)].filter(Boolean).join('・')}
              </div>
            </div>
            <span className="chip danger">停課</span>
          </div>
        ))}
        {result.reschedules.map((r, i) => (
          <div className="p-item" key={'r' + i}>
            <div className="p-main">
              <div style={{ fontWeight: 600 }}>
                {formatDateZh(r.lesson.date)} → {r.date ? formatDateZh(r.date) : formatDateZh(r.lesson.date)}
              </div>
              <div className="tiny faint">
                {r.start_time ? `${r.start_time}–${r.end_time ?? ''}` : `${r.lesson.start_time}–${r.lesson.end_time}`}
              </div>
            </div>
            <span className="chip accent">改期</span>
          </div>
        ))}
      </div>

      {isCreate && !applied && (
        <label className="row" style={{ padding: '10px 13px 0', gap: 8, cursor: 'pointer' }}>
          <input type="checkbox" checked={learnPatterns} onChange={(e) => setLearnPatterns(e.target.checked)}
            style={{ width: 16, height: 16, accentColor: 'var(--accent)' }} />
          <span className="small muted">記成固定課表（以後同星期同時段自動帶入這個班級）</span>
        </label>
      )}

      <div className="p-foot">
        {applied ? (
          <span className="chip ok" style={{ padding: '7px 12px' }}>✓ 已寫入行事曆</span>
        ) : (
          <button className="btn primary" onClick={onApply}>
            {isCreate ? '加入行事曆' : '確認執行'}
          </button>
        )}
      </div>
    </div>
  )
}

function DraftRow({
  d, data, onDrop, disabled,
}: { d: LessonDraft; data: AppData; onDrop: () => void; disabled: boolean }) {
  const g = d.group_id ? data.nameOf.group(d.group_id) : d.group_name
  const c = d.course_id ? data.nameOf.course(d.course_id) : d.course_name
  const l = d.location_id ? data.nameOf.location(d.location_id) : d.location_name
  const inferred = (Object.entries(d.sources) as [string, string][])
    .filter(([, v]) => v === 'pattern')
    .map(([k]) => ({ time: '時間', location: '地點', course: '課程', group: '班級' } as any)[k])
    .filter(Boolean)

  return (
    <div className="p-item">
      <div className="p-main">
        <div style={{ fontWeight: 640 }}>
          {formatDateZh(d.date)} <span className="mono">{d.start_time}–{d.end_time}</span>
        </div>
        <div className="tiny muted">
          {[l, c, g].filter(Boolean).join('・') || '（尚未指定班級）'}
        </div>
        <div className="row wrap" style={{ gap: 5 }}>
          {d.is_substitute ? <span className="chip sub">代課</span> : null}
          {d.sources.substitute === 'stated' && !d.is_substitute ? <span className="chip">不是代課</span> : null}
          {inferred.length > 0 && <span className="chip accent">{inferred.join('/')}由固定課表推斷</span>}
          {d.sources.time === 'default' && <span className="chip warn">時間用預設</span>}
          {d.conflict && <span className="chip danger">時段已有課</span>}
        </div>
        {d.topic && <div className="tiny" style={{ color: 'var(--ok)' }}>本堂：{d.topic}</div>}
        {d.prev_topic_manual && <div className="tiny faint">上次：{d.prev_topic_manual}</div>}
      </div>
      {!disabled && (
        <button className="btn ghost sm" onClick={onDrop} aria-label="移除這筆">✕</button>
      )}
    </div>
  )
}

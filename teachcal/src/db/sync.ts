import type { Session, SupabaseClient } from '@supabase/supabase-js'
import { db, getSettings, saveSettings } from './local'
import { TABLES, type Base, type Settings, type TableName } from './types'

// ---------------------------------------------------------------------------
// 連線
// ---------------------------------------------------------------------------

let client: SupabaseClient | null = null
let clientKey = ''

/**
 * Supabase SDK 是整包程式最大的相依，所以改成用到才載入。
 * 沒設定雲端同步的人，一開始完全不會下載這段程式碼。
 */
export async function getClient(s: Settings): Promise<SupabaseClient | null> {
  if (!s.supabase_url || !s.supabase_anon_key) return null
  const key = s.supabase_url + '|' + s.supabase_anon_key
  if (client && clientKey === key) return client
  try {
    const { createClient } = await import('@supabase/supabase-js')
    client = createClient(s.supabase_url, s.supabase_anon_key, {
      auth: { persistSession: true, autoRefreshToken: true, storageKey: 'teachcal-auth' },
    })
    clientKey = key
    return client
  } catch {
    return null
  }
}

export function resetClient() {
  client = null
  clientKey = ''
}

export type SyncState =
  | { status: 'off'; message: string }
  | { status: 'signed-out'; message: string }
  | { status: 'idle'; message: string; lastAt?: string; pending: number }
  | { status: 'syncing'; message: string }
  | { status: 'error'; message: string }

export async function currentSession(): Promise<Session | null> {
  const s = await getSettings()
  const c = await getClient(s)
  if (!c) return null
  const { data } = await c.auth.getSession()
  return data.session ?? null
}

export async function signIn(email: string, password: string): Promise<void> {
  const s = await getSettings()
  const c = await getClient(s)
  if (!c) throw new Error('尚未設定 Supabase 連線資訊')
  const { error } = await c.auth.signInWithPassword({ email, password })
  if (error) throw new Error(translateAuthError(error.message))
}

export async function signUp(email: string, password: string): Promise<string> {
  const s = await getSettings()
  const c = await getClient(s)
  if (!c) throw new Error('尚未設定 Supabase 連線資訊')
  const { data, error } = await c.auth.signUp({ email, password })
  if (error) throw new Error(translateAuthError(error.message))
  return data.session ? '註冊完成，已登入。' : '註冊完成，請到信箱收驗證信後再登入。'
}

export async function signOut(): Promise<void> {
  const s = await getSettings()
  const c = await getClient(s)
  await c?.auth.signOut()
}

function translateAuthError(msg: string): string {
  if (/Invalid login credentials/i.test(msg)) return '帳號或密碼錯誤'
  if (/Email not confirmed/i.test(msg)) return '信箱還沒驗證，請先到信箱點驗證連結'
  if (/User already registered/i.test(msg)) return '這個信箱已經註冊過了，直接登入即可'
  if (/Password should be at least/i.test(msg)) return '密碼太短，至少要 6 碼'
  if (/fetch|network/i.test(msg)) return '連不上 Supabase，請確認網址與網路'
  return msg
}

// ---------------------------------------------------------------------------
// 欄位轉換：本機 <-> 雲端
// ---------------------------------------------------------------------------

function toRemote(table: TableName, row: any, userId: string): any {
  const { dirty: _dirty, ...rest } = row
  const out: any = { ...rest, user_id: userId, deleted: !!row.deleted }
  if (table === 'courses' || table === 'groups') {
    out.aliases = Array.isArray(row.aliases) ? row.aliases : []
  }
  if (table === 'lessons') {
    out.attendance = row.attendance ?? {}
    out.is_substitute = row.is_substitute ? 1 : 0
    out.kind = row.kind ?? 'class'
    out.guest_students = Array.isArray(row.guest_students) ? row.guest_students : []
  }
  if (table === 'students') out.active = row.active ? 1 : 0
  if (table === 'patterns') out.active = row.active ? 1 : 0
  // 雲端不需要這個欄位，它是伺服器自己維護的
  delete out.server_ts
  return out
}

function toLocal(table: TableName, row: any): any {
  const out: any = { ...row, deleted: row.deleted ? 1 : 0, dirty: 0 }
  delete out.user_id
  delete out.server_ts
  if (table === 'courses' || table === 'groups') {
    out.aliases = Array.isArray(row.aliases) ? row.aliases : []
  }
  if (table === 'lessons') {
    out.attendance = row.attendance ?? {}
    out.is_substitute = row.is_substitute ? 1 : 0
    out.kind = row.kind ?? 'class'
    out.guest_students = Array.isArray(row.guest_students) ? row.guest_students : []
  }
  if (table === 'students') out.active = row.active ? 1 : 0
  if (table === 'patterns') out.active = row.active ? 1 : 0
  return out
}

// ---------------------------------------------------------------------------
// 同步
// ---------------------------------------------------------------------------

export async function pendingCount(): Promise<number> {
  let n = 0
  for (const t of TABLES) {
    n += await (db as any)[t].where('dirty').equals(1).count()
  }
  return n
}

let syncing = false

export interface SyncOutcome {
  pushed: number
  pulled: number
  at: string
  error?: string
}

/**
 * 雙向同步。
 * 1. 先把本機 dirty=1 的列推上去（upsert）
 * 2. 再把 server_ts 大於上次水位線的列拉下來
 * 衝突以 updated_at 較新者勝；本機有未推送變更且時間較新時保留本機。
 */
export async function syncNow(force = false): Promise<SyncOutcome> {
  if (syncing && !force) return { pushed: 0, pulled: 0, at: new Date().toISOString(), error: '同步進行中' }
  syncing = true
  const at = new Date().toISOString()
  let pushed = 0
  let pulled = 0
  try {
    const settings = await getSettings()
    const c = await getClient(settings)
    if (!c) return { pushed, pulled, at, error: '尚未設定 Supabase' }
    const { data: sess } = await c.auth.getSession()
    const userId = sess.session?.user.id
    if (!userId) return { pushed, pulled, at, error: '尚未登入' }

    // ---- 推送 ----
    for (const t of TABLES) {
      const dirtyRows: Base[] = await (db as any)[t].where('dirty').equals(1).toArray()
      if (!dirtyRows.length) continue
      for (let i = 0; i < dirtyRows.length; i += 200) {
        const chunk = dirtyRows.slice(i, i + 200)
        const payload = chunk.map((r) => toRemote(t, r, userId))
        const { error } = await c.from(t).upsert(payload, { onConflict: 'id' })
        if (error) throw new Error(`推送 ${t} 失敗：${error.message}`)
        await (db as any)[t].bulkPut(chunk.map((r) => ({ ...r, dirty: 0 })))
        pushed += chunk.length
      }
    }

    // ---- 拉取 ----
    const since = settings.last_pull_at ?? '1970-01-01T00:00:00Z'
    let watermark = since
    for (const t of TABLES) {
      let from = 0
      const page = 500
      for (;;) {
        const { data, error } = await c
          .from(t)
          .select('*')
          .gt('server_ts', since)
          .order('server_ts', { ascending: true })
          .range(from, from + page - 1)
        if (error) throw new Error(`拉取 ${t} 失敗：${error.message}`)
        if (!data?.length) break
        const toWrite: any[] = []
        for (const remote of data) {
          if (remote.server_ts && remote.server_ts > watermark) watermark = remote.server_ts
          const local = await (db as any)[t].get(remote.id)
          if (!local) { toWrite.push(toLocal(t, remote)); continue }
          // 本機有未推送的變更且比較新 → 保留本機（下次同步會推上去）
          if (local.dirty === 1 && local.updated_at > remote.updated_at) continue
          if (local.updated_at <= remote.updated_at) toWrite.push(toLocal(t, remote))
        }
        if (toWrite.length) await (db as any)[t].bulkPut(toWrite)
        pulled += toWrite.length
        if (data.length < page) break
        from += page
      }
    }

    await saveSettings({ last_pull_at: watermark })
    return { pushed, pulled, at }
  } catch (e: any) {
    return { pushed, pulled, at, error: e?.message ?? String(e) }
  } finally {
    syncing = false
  }
}

/** 第一次連線：把本機所有資料標成 dirty 再全部推上去 */
export async function pushEverything(): Promise<SyncOutcome> {
  for (const t of TABLES) {
    const rows = await (db as any)[t].toArray()
    await (db as any)[t].bulkPut(rows.map((r: Base) => ({ ...r, dirty: 1 })))
  }
  return syncNow(true)
}

/** 從雲端重新完整拉一次（例如新裝置） */
export async function pullEverything(): Promise<SyncOutcome> {
  await saveSettings({ last_pull_at: '1970-01-01T00:00:00Z' })
  return syncNow(true)
}

// ---------------------------------------------------------------------------
// 自動同步：上線時、視窗回到前景時、每 2 分鐘一次
// ---------------------------------------------------------------------------

let timer: number | null = null
let listeners: (() => void)[] = []

export function onSynced(cb: () => void): () => void {
  listeners.push(cb)
  return () => { listeners = listeners.filter((x) => x !== cb) }
}

async function tick() {
  if (!navigator.onLine) return
  const s = await getSettings()
  if (!s.supabase_url || !s.supabase_anon_key) return
  const out = await syncNow()
  if (!out.error && (out.pushed || out.pulled)) listeners.forEach((l) => l())
}

export function startAutoSync() {
  if (timer !== null) return
  timer = window.setInterval(tick, 120_000)
  window.addEventListener('online', tick)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') tick()
  })
  tick()
}

export function stopAutoSync() {
  if (timer !== null) { window.clearInterval(timer); timer = null }
}

export async function triggerSync(): Promise<SyncOutcome> {
  const out = await syncNow()
  if (!out.error) listeners.forEach((l) => l())
  return out
}

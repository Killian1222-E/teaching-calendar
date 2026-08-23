import Dexie, { type Table } from 'dexie'
import type {
  Course, Group, Lesson, Location, Pattern, Settings, Student,
} from './types'

export class TeachCalDB extends Dexie {
  locations!: Table<Location, string>
  courses!: Table<Course, string>
  groups!: Table<Group, string>
  students!: Table<Student, string>
  patterns!: Table<Pattern, string>
  lessons!: Table<Lesson, string>
  settings!: Table<Settings, string>

  constructor() {
    super('teachcal')
    this.version(1).stores({
      locations: 'id, name, deleted, dirty, updated_at',
      courses: 'id, name, deleted, dirty, updated_at',
      groups: 'id, name, deleted, dirty, updated_at',
      students: 'id, group_id, name, deleted, dirty, updated_at',
      patterns: 'id, weekday, group_id, deleted, dirty, updated_at',
      lessons: 'id, date, group_id, course_id, location_id, deleted, dirty, updated_at, [group_id+date]',
      settings: 'id',
    })

    // v2：新增「大活動」種類與代課臨時名單
    this.version(2).stores({
      lessons: 'id, date, kind, group_id, course_id, location_id, deleted, dirty, updated_at, [group_id+date]',
    }).upgrade(async (tx) => {
      await tx.table('lessons').toCollection().modify((l: any) => {
        if (!l.kind) l.kind = 'class'
        if (!Array.isArray(l.guest_students)) l.guest_students = []
      })
    })
  }
}

export const db = new TeachCalDB()

export function nowISO(): string {
  return new Date().toISOString()
}

export function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return 'x' + Math.random().toString(36).slice(2) + Date.now().toString(36)
}

const DEFAULT_SETTINGS: Settings = {
  id: 'app',
  ai_provider: 'none',
  ai_model: 'claude-sonnet-4-5-20250929',
  theme: 'system',
  default_lesson_minutes: 90,
}

/**
 * 純讀取，不寫入。
 * useLiveQuery 會在唯讀交易裡呼叫這支函式，這裡若寫入會噴 ReadOnlyError。
 */
export async function getSettings(): Promise<Settings> {
  const s = await db.settings.get('app')
  return s ? { ...DEFAULT_SETTINGS, ...s } : { ...DEFAULT_SETTINGS }
}

/** 啟動時呼叫一次，把預設值落地 */
export async function ensureSettings(): Promise<Settings> {
  const s = await db.settings.get('app')
  if (s) return { ...DEFAULT_SETTINGS, ...s }
  await db.settings.put(DEFAULT_SETTINGS)
  return { ...DEFAULT_SETTINGS }
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const cur = await getSettings()
  const next = { ...cur, ...patch, id: 'app' as const }
  await db.settings.put(next)
  return next
}

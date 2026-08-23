import type { Course, Group, ID, Lesson, Location, Pattern } from '../db/types'

export interface ParseContext {
  today: string
  locations: Location[]
  courses: Course[]
  groups: Group[]
  patterns: Pattern[]
  lessons: Lesson[]
  defaultMinutes: number
}

/** 欄位來源：使用者明講 / 從固定課表推斷 / 系統預設 */
export type FieldSource = 'stated' | 'pattern' | 'default'

export interface LessonDraft {
  /** 一般課程還是大活動 */
  kind?: 'class' | 'event'
  /** 大活動名稱 */
  title?: string
  /** 代課 / 大活動的臨時名單 */
  guest_students?: string[]
  /** 人數 */
  headcount?: number
  date: string
  start_time: string
  end_time: string
  location_id?: ID
  location_name?: string
  course_id?: ID
  course_name?: string
  group_id?: ID
  group_name?: string
  is_substitute: 0 | 1
  substitute_for?: string
  topic?: string
  prev_topic_manual?: string
  note?: string
  pattern_id?: ID
  /** 每個欄位是怎麼來的，UI 用來標示「推斷」徽章 */
  sources: Partial<Record<
    'date' | 'time' | 'location' | 'course' | 'group' | 'substitute', FieldSource
  >>
  /** 這些實體目前資料庫沒有，套用時會新建 */
  creates: { locations: string[]; courses: string[]; groups: string[] }
  conflict?: Lesson
}

export type Intent = 'create' | 'cancel' | 'reschedule' | 'set_topic' | 'query' | 'unknown'

export interface CancelTarget {
  lesson: Lesson
  reason?: string
}

export interface TopicUpdate {
  lesson: Lesson
  topic: string
}

export interface ParseResult {
  intent: Intent
  /** 0~1，低於 0.55 時會建議轉給 AI */
  confidence: number
  drafts: LessonDraft[]
  cancels: CancelTarget[]
  topicUpdates: TopicUpdate[]
  reschedules: { lesson: Lesson; date?: string; start_time?: string; end_time?: string }[]
  /** 查詢型指令的回答 */
  answer?: string
  /** 沒被理解的片段 */
  unresolved: string[]
  warnings: string[]
  /** 規則解析器覺得自己力有未逮 */
  needsAI: boolean
  source: 'rules' | 'ai'
  raw: string
}

export function emptyResult(raw: string): ParseResult {
  return {
    intent: 'unknown',
    confidence: 0,
    drafts: [],
    cancels: [],
    topicUpdates: [],
    reschedules: [],
    unresolved: [],
    warnings: [],
    needsAI: true,
    source: 'rules',
    raw,
  }
}

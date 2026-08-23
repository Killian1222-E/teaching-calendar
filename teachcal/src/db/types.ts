// ---------------------------------------------------------------------------
// 資料模型
// 每張表都有 updated_at (ISO 字串) 與 deleted (軟刪除)，同步引擎靠這兩個欄位
// 做「後寫入者勝」的雙向合併。dirty=1 代表本機有尚未推送到雲端的變更。
// ---------------------------------------------------------------------------

export type ID = string

export interface Base {
  id: ID
  updated_at: string
  deleted: 0 | 1
  /** 本機專用：1 = 尚未同步到雲端 */
  dirty: 0 | 1
}

/** 上課地點，例如「三民分校」 */
export interface Location extends Base {
  name: string
  address?: string
  color: string
}

/** 課程種類，例如「Minecraft 教育版」「樂高教育」 */
export interface Course extends Base {
  name: string
  /** 用來比對自然語言的別名，例如 ["mc","麥塊","當個創世神"] */
  aliases: string[]
  color: string
}

/** 班級 / 學生組，例如「學生組B」 */
export interface Group extends Base {
  name: string
  aliases: string[]
  default_location_id?: ID
  default_course_id?: ID
  note?: string
}

/** 學生，屬於某個班級 */
export interface Student extends Base {
  group_id: ID
  name: string
  note?: string
  active: 0 | 1
}

/**
 * 固定課表 — 這是「星期一 1400-1530 都是學生組B」這條規則的存放處。
 * AI 助理在使用者沒講班級時，就是查這張表推斷出來的。
 */
export interface Pattern extends Base {
  /** 0=週日 … 6=週六 */
  weekday: number
  start_time: string // "14:00"
  end_time: string   // "15:30"
  location_id?: ID
  course_id?: ID
  group_id?: ID
  active: 0 | 1
  /** 生效起訖日，留白代表永久有效 */
  valid_from?: string
  valid_to?: string
}

export type LessonStatus = 'planned' | 'done' | 'cancelled'
export type AttendanceMark = 'present' | 'absent' | 'late'

/**
 * 行程種類。
 * class = 常態課程，綁定某個學生組別
 * event = 大活動（企業營隊、參訪、體驗營…），人數多、通常是一次性，不綁班級
 */
export type LessonKind = 'class' | 'event'

/** 一堂實際的課，或一場大活動 */
export interface Lesson extends Base {
  kind: LessonKind
  /** 大活動的名稱，例如「中鋼員工子女營」 */
  title?: string
  date: string       // "2026-08-25"
  start_time: string // "13:00"
  end_time: string   // "14:30"
  location_id?: ID
  course_id?: ID
  group_id?: ID
  /** 是否為代課 */
  is_substitute: 0 | 1
  /** 代誰的課 */
  substitute_for?: string
  /**
   * 代課時的臨時學生名單。代課帶的通常不是自己的常態班級，
   * 所以名字直接記在這堂課上，不會污染班級名單。
   */
  guest_students: string[]
  /** 這堂課的學生人數。沒有逐一打名字時可以只填數字 */
  headcount?: number
  /** 這堂課實際上教的內容，例如「狗狗圍欄」 */
  topic?: string
  /**
   * 使用者手動指定的「上次上的內容」。留白時系統會自動從歷史紀錄推導，
   * 這個欄位存在時優先顯示（用於剛開始使用、歷史還沒建起來的情況）。
   */
  prev_topic_manual?: string
  note?: string
  status: LessonStatus
  attendance: Record<ID, AttendanceMark>
  /** 由哪個固定課表產生的（若有），方便日後整批調整 */
  pattern_id?: ID
}

export interface Settings {
  id: 'app'
  supabase_url?: string
  supabase_anon_key?: string
  ai_provider?: 'anthropic' | 'openai' | 'none'
  ai_api_key?: string
  ai_model?: string
  last_pull_at?: string
  theme?: 'dark' | 'light' | 'system'
  default_lesson_minutes?: number
}

export const TABLES = [
  'locations',
  'courses',
  'groups',
  'students',
  'patterns',
  'lessons',
] as const
export type TableName = (typeof TABLES)[number]

/** 這些欄位只存在於本機，推送到雲端時要剝掉 */
export const LOCAL_ONLY_FIELDS = ['dirty'] as const

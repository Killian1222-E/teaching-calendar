import { db } from './local'
import { create, pickColor } from './repo'
import type { Course } from './types'

/**
 * 第一次開啟時，先放進兩個常用課程種類（不放假資料、不放假學生）。
 * 這樣新使用者打開就能直接排課，而不是面對一片空白的下拉選單。
 */
export async function seedIfEmpty(): Promise<void> {
  const n = await db.courses.count()
  if (n > 0) return
  const defaults = [
    { name: '樂高教育', aliases: ['樂高', 'LEGO', 'WeDo', 'SPIKE', 'EV3'] },
    { name: 'Minecraft 教育版', aliases: ['Minecraft', 'MC', '麥塊', '創世神'] },
  ]
  for (let i = 0; i < defaults.length; i++) {
    await create<Course>('courses', { ...defaults[i], color: pickColor(i + 3) })
  }
}

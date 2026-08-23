import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'tw.teachcal.app',
  appName: '課程行事曆',
  webDir: 'dist',
  android: {
    // 用 https scheme，這樣 IndexedDB 與 Supabase 的 CORS 行為才跟瀏覽器一致
    allowMixedContent: false,
  },
  server: {
    androidScheme: 'https',
  },
}

export default config

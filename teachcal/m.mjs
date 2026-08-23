import { chromium } from 'playwright'
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
const p = await (await b.newContext({ viewport:{width:1280,height:880} })).newPage()
await p.goto('http://127.0.0.1:5173/', { waitUntil:'networkidle' }); await p.waitForTimeout(900)
const info = await p.evaluate(() => {
  const c = document.querySelector('.cal-cell')
  const cs = getComputedStyle(c)
  const g = document.querySelector('.cal-grid')
  return { w: c.getBoundingClientRect().width, h: c.getBoundingClientRect().height,
           ar: cs.aspectRatio, mh: cs.minHeight, gridH: g.getBoundingClientRect().height,
           rows: getComputedStyle(g).gridTemplateRows }
})
console.log(info)
await b.close()

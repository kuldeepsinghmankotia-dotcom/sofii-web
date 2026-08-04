import { chromium } from 'playwright'
import fs from 'fs'

const BASE = 'https://sofii-web.vercel.app'
const IMG_PATH = process.argv[2]

const browser = await chromium.launch()
const context = await browser.newContext()
const page = await context.newPage()

await page.goto(`${BASE}/sign-in`)
await page.fill('input[type="email"]', 'kuldeepsinghmankotia@gmail.com')
await page.fill('input[type="password"]', 'munnniii199199')
await page.click('button[type="submit"]')
await page.waitForTimeout(2500)
console.log('post-auth url:', page.url())

await page.goto(`${BASE}/`)
await page.click('text=+ New conversation')
await page.waitForURL(/\/c\//, { timeout: 15000 })
const conversationId = page.url().split('/c/')[1]
console.log('conversation id:', conversationId)

const base64 = fs.readFileSync(IMG_PATH).toString('base64')
const dataUrl = `data:image/png;base64,${base64}`

const start = Date.now()
const response = await page.request.post(`${BASE}/api/chat`, {
  data: { conversationId, content: 'What colors are in this image, top and bottom?', imageUrl: dataUrl },
  timeout: 60000
})
console.log('elapsed ms:', Date.now() - start)
console.log('status:', response.status())
const text = await response.text()
console.log('body:', text.slice(0, 500))

await browser.close()
console.log('DONE')

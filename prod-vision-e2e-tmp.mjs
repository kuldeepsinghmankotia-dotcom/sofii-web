import { chromium } from 'playwright'

const BASE = 'https://sofii-web.vercel.app'
const IMG_PATH = process.argv[2]

const browser = await chromium.launch()
const context = await browser.newContext()
const page = await context.newPage()

await page.goto(`${BASE}/sign-in`)
await page.fill('input[type="email"]', 'kuldeepsinghmankotia@gmail.com')
await page.fill('input[type="password"]', 'munnniii199199')
await page.click('button[type="submit"]')
await page.waitForTimeout(2000)
console.log('post-auth url:', page.url())

await page.goto(`${BASE}/`)
await page.click('text=+ New conversation')
await page.waitForURL(/\/c\//)
const conversationId = page.url().split('/c/')[1]
console.log('test conversation id:', conversationId)

const fileInput = await page.$('input[type="file"][accept="image/*"]')
await fileInput.setInputFiles(IMG_PATH)
await page.waitForTimeout(500)
console.log('image preview attached:', (await page.$('img[alt="To send"]')) !== null)

await page.fill('input[placeholder="Type your message..."]', 'What colors are in this image, top and bottom?')
await page.click('text=Send')
await page.waitForTimeout(15000)

const body = await page.textContent('body')
console.log('--- production vision chat response ---')
console.log('mentions purple:', /purple|violet/i.test(body))
console.log('mentions orange:', /orange/i.test(body))
console.log('snippet:', body.replace(/\s+/g, ' ').slice(-500))

const userBubbleImg = await page.$('img[alt="Attached"]')
console.log('message bubble shows uploaded image:', userBubbleImg !== null)
if (userBubbleImg) {
  const src = await userBubbleImg.getAttribute('src')
  console.log('image src is a real public URL:', src?.startsWith('https://ujtawrzjpiaqeezwsvdw.supabase.co/storage'))
}

await browser.close()
console.log('DONE — test conversation id for cleanup:', conversationId)

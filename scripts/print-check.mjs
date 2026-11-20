import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:net'
import { chromium } from 'playwright-core'

const listener = createServer()
await new Promise((resolve, reject) => listener.listen(0, '127.0.0.1', resolve).once('error', reject))
const { port } = listener.address()
await new Promise(resolve => listener.close(resolve))
const url = `http://127.0.0.1:${port}`
const temporary = await mkdtemp(join(tmpdir(), 'dcr-print-'))
const serverEnv = { ...process.env, PORT: String(port), HOST: '127.0.0.1', OPENAI_API_KEY: '', DOTENV_CONFIG_QUIET: 'true' }
const server = spawn(process.execPath, ['server/index.mjs', '--dev'], { env: serverEnv, stdio: 'inherit' })
let browser
try {
  for (let attempt = 0; ; attempt++) {
    const ready = await fetch(url + '/api/status').then(response => response.ok).catch(() => false)
    if (ready) break
    if (attempt === 100 || server.exitCode !== null) throw new Error('測試伺服器無法啟動')
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
    args: ['--no-sandbox'],
    env: { ...process.env, XDG_CONFIG_HOME: temporary, XDG_CACHE_HOME: temporary, XDG_RUNTIME_DIR: temporary },
  })
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, locale: 'zh-TW' })
  page.setDefaultTimeout(10000)
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('dialog', dialog => void dialog.accept())
  await page.goto(url)
  await page.getByRole('heading', { name: '工作日誌', exact: true }).waitFor()
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), '手機版工作區超出螢幕')
  await page.getByRole('button', { name: '歷史日誌', exact: true }).click()
  await page.getByRole('button', { name: /2026年11月20日/ }).click()
  await page.getByText('150T吊車1台', { exact: false }).waitFor()
  await page.getByRole('button', { name: '來源紀錄 1' }).first().click()
  const source = page.getByRole('textbox', { name: /紀錄 1$/ })
  const previous = await source.inputValue()
  await source.fill(previous.replace('完成3支', '完成4支'))
  await page.getByRole('button', { name: '儲存草稿' }).click()
  await page.getByText('草稿已儲存。').waitFor()
  await page.reload()
  await page.getByRole('button', { name: '歷史日誌', exact: true }).click()
  await page.getByRole('button', { name: /2026年11月20日/ }).click()
  await page.getByRole('button', { name: '返回工作敘述' }).click()
  assert.match(await source.inputValue(), /完成4支/)
  await page.getByRole('button', { name: 'AI 整理日誌' }).click()
  await page.getByText('本次採用示範規則分類。', { exact: false }).waitFor()
  const work = page.locator('.report-row').filter({ hasText: 'A區 鋼柱吊裝' }).first()
  await work.getByRole('button', { name: '編輯' }).click()
  const longValue = 'STARTOFPRINT ' + 'ABCDE12345'.repeat(45) + ' ENDOFPRINT'
  await work.getByRole('textbox', { name: '工作說明' }).fill(longValue)
  await work.getByRole('button', { name: '確認修改' }).click()
  await page.getByRole('button', { name: '儲存日誌' }).click()
  await page.getByText('日誌已儲存。').waitFor()
  await page.emulateMedia({ media: 'print' })
  assert.equal(await page.locator('button:visible, input:visible, textarea:visible, select:visible').count(), 0, '列印出現操作控制項')
  const pdf = join(temporary, 'report.pdf')
  await page.pdf({ path: pdf, preferCSSPageSize: true, printBackground: true })
  const output = execFileSync('pdftotext', ['-bbox', pdf, '-'], { encoding: 'utf8' })
  const pages = [...output.matchAll(/<page width="([\d.]+)" height="([\d.]+)">([\s\S]*?)<\/page>/g)]
  assert(pages.length > 0, 'PDF 無頁面')
  assert.match(output, /STARTOFPRINT/)
  assert.match(output, /ENDOFPRINT/)
  assert.equal(output.replace(/<[^>]*>|\s/g, '').match(/ABCDE12345/g)?.length, 45, '長欄位被截斷')
  assert.doesNotMatch(output, /儲存日誌|確認修改|版本紀錄|列印／PDF/)
  for (const [, width, height, content] of pages) {
    assert(Math.abs(Number(width) - 595.28) < 2 && Math.abs(Number(height) - 841.89) < 2, '列印必須為 A4')
    for (const word of content.matchAll(/<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)"/g)) {
      const [, xMin, yMin, xMax, yMax] = word.map(Number)
      assert(xMin >= 0 && yMin >= 0 && xMax <= Number(width) && yMax <= Number(height), '欄位文字超出 PDF 頁面')
    }
  }
  assert.deepEqual(errors, [])
  console.log(`通過：手機版操作、IndexedDB 重開讀取、示範分類、報表編輯、A4 PDF（${pages.length} 頁，無可見按鈕或測試欄位裁切）。`)
} finally {
  await browser?.close()
  server.kill()
  await rm(temporary, { recursive: true, force: true })
}

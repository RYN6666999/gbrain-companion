/**
 * verify-browser.ts — 確認實際啟動的是哪個瀏覽器 binary
 *
 * Usage:
 *   GEMINI_PROFILE_DIR="..." CHROME_EXECUTABLE="..." bun run verify-browser
 *   GEMINI_PROFILE_DIR="..." CFT_EXECUTABLE="..." bun run verify-browser
 */
import { chromium } from 'playwright';

const profileDir = process.env['GEMINI_PROFILE_DIR'];
const exe = process.env['CHROME_EXECUTABLE'] ?? process.env['CFT_EXECUTABLE'];

if (!profileDir) throw new Error('GEMINI_PROFILE_DIR not set');
if (!exe) throw new Error('CHROME_EXECUTABLE or CFT_EXECUTABLE not set');

console.log(`executablePath: ${exe}`);
console.log(`profileDir:     ${profileDir}`);

const ctx = await chromium.launchPersistentContext(profileDir, {
  headless: false,
  executablePath: exe,
  args: ['--no-first-run', '--disable-session-crashed-bubble'],
});

const page = ctx.pages()[0] ?? await ctx.newPage();
await page.goto('about:version');

// about:version 頁面顯示 Chrome 版本
const version = await page.evaluate(() => {
  const el = document.querySelector('#version');
  return el?.textContent ?? navigator.userAgent;
});

const ua = await page.evaluate(() => navigator.userAgent);
console.log(`\nabout:version content: ${version}`);
console.log(`userAgent: ${ua}`);

// CDP 取版本
const cdp = await ctx.newCDPSession(page);
const browserVersion = await cdp.send('Browser.getVersion');
console.log(`\nCDP Browser.getVersion:`);
console.log(JSON.stringify(browserVersion, null, 2));

await ctx.close();

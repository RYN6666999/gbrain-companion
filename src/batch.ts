/**
 * batch.ts — persistent-driver batch summarizer
 *
 * Reads a list of slugs from argv or stdin (one per line), initializes the
 * browser ONCE, then processes every slug without restarting. Shutdown happens
 * at the very end. This is the fastest mode for multiple pages.
 *
 * Usage:
 *   # argv slugs
 *   bun run batch wiki/projects/super-engine wiki/projects/foo wiki/projects/bar
 *
 *   # stdin slugs
 *   echo -e "wiki/a\nwiki/b" | bun run batch
 *
 * Perf note (2026-05-17 benchmark):
 *   newConversation: false  → gen median ~10.4s  (-57% vs true)
 *   newConversation: true   → gen median ~24.4s  (baseline)
 *   → false is now the default; each prompt is prefixed with SOFT_RESET_PREFIX
 *     so Gemini treats it as a new independent task despite reusing the session.
 *   Set NEW_CONVERSATION=1 env var to force a full page reload per slug.
 */

import { getPage } from './gbrain-client.ts';
import { GeminiWebDriver } from 'weblm-driver';

const profileDir    = process.env['GEMINI_PROFILE_DIR'];
const executablePath = process.env['CHROME_EXECUTABLE'];
const headless      = process.env['HEADLESS'] === '1';
// NEW_CONVERSATION=1 forces a full page reload per slug (slower, cleaner context)
const newConversation = process.env['NEW_CONVERSATION'] === '1';
// Soft reset prefix signals a new independent task without reloading the page
const SOFT_RESET_PREFIX = newConversation ? '' : '[新任務，請忽略上一個對話]\n\n';
if (!profileDir) throw new Error('GEMINI_PROFILE_DIR is not set');

// Collect slugs from argv or stdin
let slugs = process.argv.slice(2);
if (slugs.length === 0) {
  const stdin = await Bun.stdin.text();
  slugs = stdin.split('\n').map(s => s.trim()).filter(Boolean);
}
if (slugs.length === 0) {
  console.error('Usage: bun run batch <slug1> [slug2 ...] OR pipe slugs via stdin');
  process.exit(1);
}

console.log(`Processing ${slugs.length} slug(s) with persistent driver... [newConversation=${newConversation}]`);

const driver = new GeminiWebDriver({
  providerUrl: 'https://gemini.google.com/app',
  profileDir,
  ...(executablePath ? { executablePath } : {}),
  headless,
  firstTokenTimeoutMs: 30_000,
  stabilityTimeoutMs: 120_000,
  stabilityIntervalMs: 500,
  args: [
    '--no-first-run',
    '--disable-session-crashed-bubble',
    '--blink-settings=imagesEnabled=false',
    '--disable-features=AutoplayPolicy',
  ],
});

const t0 = Date.now();
await driver.init();
console.log(`Browser ready in ${((Date.now() - t0) / 1000).toFixed(1)}s\n`);

try {
  for (let i = 0; i < slugs.length; i++) {
    const slug = slugs[i];
    const tSlug = Date.now();
    process.stdout.write(`[${i + 1}/${slugs.length}] ${slug} ... `);

    const page = await getPage(slug);
    if (!page) {
      console.log('NOT FOUND');
      continue;
    }

    const prompt = SOFT_RESET_PREFIX + `請用繁體中文摘要以下內容，至少200字：\n\n${page.compiled_truth}`;
    try {
      const result = await driver.generate({ prompt, timeoutMs: 90_000, newConversation });
      if (result.outputKind !== 'normal') throw new Error(`outputKind: ${result.outputKind}`);
      const elapsed = ((Date.now() - tSlug) / 1000).toFixed(1);
      console.log(`${elapsed}s (${result.text.length} chars)`);
      console.log('\n' + result.text + '\n' + '─'.repeat(60));
    } catch (e) {
      console.log(`ERROR: ${e}`);
    }
  }
} finally {
  await driver.shutdown().catch(() => {});
  const total = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\nDone. Total: ${total}s for ${slugs.length} slug(s)`);
}

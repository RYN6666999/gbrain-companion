import { getPage } from './gbrain-client.ts';
import { GeminiWebDriver } from 'weblm-driver';

const slug = process.argv[2] ?? 'wiki/projects/super-engine';

const profileDir = process.env['GEMINI_PROFILE_DIR'];
const executablePath = process.env['CHROME_EXECUTABLE'];
if (!profileDir) throw new Error('GEMINI_PROFILE_DIR is not set');

// ── 1. Read from gbrain ───────────────────────────────────────────────────────
console.log(`Reading ${slug} from gbrain...`);
const page = await getPage(slug);
if (!page) {
  console.error(`Page not found: ${slug}`);
  process.exit(1);
}

// ── 2. Build prompt ───────────────────────────────────────────────────────────
const prompt = `請用繁體中文摘要以下內容，至少200字：\n\n${page.compiled_truth}`;

// ── 3. Ask Gemini ─────────────────────────────────────────────────────────────
console.log('Asking Gemini to summarize...');
const driver = new GeminiWebDriver({
  providerUrl: 'https://gemini.google.com/app',
  profileDir,
  ...(executablePath ? { executablePath } : {}),
  headless: false,
  firstTokenTimeoutMs: 30_000,
  stabilityTimeoutMs: 120_000,
  stabilityIntervalMs: 1_500,
  args: ['--no-first-run', '--disable-session-crashed-bubble'],
});

await driver.init();
try {
  const result = await driver.generate({ prompt, timeoutMs: 90_000, newConversation: true });
  if (result.outputKind !== 'normal') {
    throw new Error(`Unexpected outputKind: ${result.outputKind}`);
  }

  // ── 4. Print response ───────────────────────────────────────────────────────
  console.log('\n--- Gemini Response ---');
  console.log(result.text);
  console.log('----------------------');
  console.log(`Done. (${result.text.length} chars)`);
} finally {
  await driver.shutdown();
}

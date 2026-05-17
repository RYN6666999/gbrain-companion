/**
 * bench-cft-worker.ts — spawned per-run by bench-cft.ts
 * Env vars: _BENCH_EXE, _BENCH_PROFILE, _BENCH_PROMPT, _BENCH_OUT
 */
import { GeminiWebDriver } from 'weblm-driver';
import { writeFileSync } from 'fs';

const exe     = process.env['_BENCH_EXE']!;
const profile = process.env['_BENCH_PROFILE']!;
const prompt  = process.env['_BENCH_PROMPT'] ?? 'Say hello in 10 words.';
const out     = process.env['_BENCH_OUT'];          // optional: if unset, print to stdout
const headless = process.env['HEADLESS'] === 'true';

const t0 = Date.now();
let initMs = 0, genMs = 0, chars = 0, ok = false, error = '';

const driver = new GeminiWebDriver({
  providerUrl: 'https://gemini.google.com/app',
  profileDir: profile,
  executablePath: exe,
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

try {
  await driver.init();
  initMs = Date.now() - t0;

  const tg = Date.now();
  const result = await driver.generate({ prompt, timeoutMs: 90_000, newConversation: true });
  genMs = Date.now() - tg;

  if (result.outputKind !== 'normal') throw new Error('outputKind: ' + result.outputKind);
  chars = result.text.length;
  ok = true;
} catch (e) {
  error = String(e);
  if (!initMs) initMs = Date.now() - t0;
} finally {
  await driver.shutdown().catch(() => {});
}

const result = JSON.stringify({ initMs, genMs, chars, ok, error }, null, 2);
if (out) {
  writeFileSync(out, result);
} else {
  console.log(result);
}

/**
 * bench-init-only.ts — 快速測試 init_ms，用於二分法找兇手 arg
 *
 * Usage:
 *   ARGS_JSON='["--no-first-run","--disable-sync"]' N=5
 *   GEMINI_PROFILE_DIR=... CHROME_EXECUTABLE=... bun run bench-init-only
 */

import { GeminiWebDriver } from 'weblm-driver';
import { fmtMs, median } from './bench-shared.ts';

const N          = Number(process.env['N']    ?? '5');
const profileDir = process.env['GEMINI_PROFILE_DIR'];
const executablePath = process.env['CHROME_EXECUTABLE'];
const headless   = process.env['HEADLESS'] === 'true';
const label      = process.env['LABEL']   ?? 'test';
const argsJson   = process.env['ARGS_JSON'];

if (!profileDir) throw new Error('GEMINI_PROFILE_DIR is not set');

let args: string[] | undefined;
if (argsJson) {
  try { args = JSON.parse(argsJson); } catch { console.error('ARGS_JSON parse failed'); process.exit(1); }
}

console.log(`\n[${label}] N=${N} args=${args?.length ?? 'default'}`);
if (args) console.log('  ' + args.join('\n  '));

const inits: number[] = [];
for (let i = 0; i < N; i++) {
  const driver = new GeminiWebDriver({
    providerUrl: 'https://gemini.google.com/app',
    profileDir: profileDir!,
    ...(executablePath ? { executablePath } : {}),
    headless,
    firstTokenTimeoutMs: 30_000,
    stabilityTimeoutMs: 120_000,
    stabilityIntervalMs: 500,
    ...(args !== undefined ? { args } : {}),
  });
  const t0 = Date.now();
  try {
    await driver.init();
    const ms = Date.now() - t0;
    inits.push(ms);
    process.stdout.write(`  [${i+1}/${N}] init=${fmtMs(ms)}\n`);
  } catch (e) {
    process.stdout.write(`  [${i+1}/${N}] ERR ${String(e).slice(0, 60)}\n`);
  } finally {
    await driver.shutdown().catch(() => {});
  }
}

const med = median(inits);
console.log(`\nMedian init: ${fmtMs(med)}  (${inits.map(v => fmtMs(v)).join(', ')})`);
console.log(`RESULT ${label}: ${fmtMs(med)}`);

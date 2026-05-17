/**
 * bench.ts — gbrain-companion performance benchmark
 *
 * Usage:
 *   N_RUNS=3 SLUG=wiki/projects/super-engine bun run bench
 *
 * Configs tested:
 *   A  baseline   headless=false, interval=1500ms, ephemeral driver (1 driver per call)
 *   B  fast-poll  headless=false, interval=500ms,  ephemeral driver
 *   C  persistent headless=false, interval=500ms,  persistent driver (1 driver, N calls)
 *   D  headless   headless=true,  interval=500ms,  ephemeral driver
 *   E  hl-persist  headless=true,  interval=500ms,  persistent driver
 */

import { getPage } from './gbrain-client.ts';
import { GeminiWebDriver } from 'weblm-driver';

const SLUG = process.env['SLUG'] ?? process.argv[2] ?? 'wiki/projects/super-engine';
const N_RUNS = Number(process.env['N_RUNS'] ?? '3');
const SKIP_HEADLESS = process.env['SKIP_HEADLESS'] === '1';
const SKIP_CFT = process.env['SKIP_CFT'] === '1';

const profileDir = process.env['GEMINI_PROFILE_DIR'];
const executablePath = process.env['CHROME_EXECUTABLE'];        // Google Chrome (baseline)
const cftExecutable = process.env['CFT_EXECUTABLE'];            // Chrome for Testing
if (!profileDir) throw new Error('GEMINI_PROFILE_DIR is not set');

const PROVIDER_URL = 'https://gemini.google.com/app';
const PROMPT_PREFIX = '請用繁體中文摘要以下內容，至少200字：\n\n';

// ─── Types ────────────────────────────────────────────────────────────────────

interface RunResult {
  durationMs: number;
  chars: number;
  ok: boolean;
  error?: string;
}

interface ConfigResult {
  name: string;
  label: string;
  runs: RunResult[];
  initMs: number;
  shutdownMs: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeDriver(opts: { headless: boolean; intervalMs: number; exe?: string }): GeminiWebDriver {
  const exe = opts.exe ?? executablePath;
  return new GeminiWebDriver({
    providerUrl: PROVIDER_URL,
    profileDir,
    ...(exe ? { executablePath: exe } : {}),
    headless: opts.headless,
    firstTokenTimeoutMs: 30_000,
    stabilityTimeoutMs: 120_000,
    stabilityIntervalMs: opts.intervalMs,
    args: [
      '--no-first-run',
      '--disable-session-crashed-bubble',
      '--blink-settings=imagesEnabled=false',
      '--disable-features=AutoplayPolicy',
    ],
  });
}

async function runGenerate(driver: GeminiWebDriver, prompt: string): Promise<RunResult> {
  const t0 = Date.now();
  try {
    const result = await driver.generate({ prompt, timeoutMs: 90_000, newConversation: true });
    if (result.outputKind !== 'normal') throw new Error(`outputKind: ${result.outputKind}`);
    return { durationMs: Date.now() - t0, chars: result.text.length, ok: true };
  } catch (e) {
    return { durationMs: Date.now() - t0, chars: 0, ok: false, error: String(e) };
  }
}

function stats(values: number[]) {
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const stddev = Math.sqrt(values.map(v => (v - mean) ** 2).reduce((a, b) => a + b, 0) / values.length);
  return { mean: Math.round(mean), stddev: Math.round(stddev), min: Math.min(...values), max: Math.max(...values) };
}

function fmtMs(ms: number) { return `${(ms / 1000).toFixed(1)}s`; }

function pad(s: string, n: number) { return s.padEnd(n); }

// ─── Config runners ───────────────────────────────────────────────────────────

async function runEphemeral(
  name: string,
  label: string,
  opts: { headless: boolean; intervalMs: number; exe?: string },
  prompt: string,
  nRuns: number,
): Promise<ConfigResult> {
  console.log(`\n[${'─'.repeat(50)}]`);
  console.log(`▶  ${name} (${label})`);
  const runs: RunResult[] = [];
  let initMs = 0, shutdownMs = 0;
  for (let i = 0; i < nRuns; i++) {
    const driver = makeDriver(opts);
    const t0 = Date.now();
    try {
      await driver.init();
    } catch (e) {
      console.error(`  init failed: ${e}`);
      runs.push({ durationMs: 0, chars: 0, ok: false, error: `init: ${e}` });
      continue;
    }
    initMs += Date.now() - t0;
    console.log(`  run ${i + 1}/${nRuns} init: ${fmtMs(Date.now() - t0)}`);

    const res = await runGenerate(driver, prompt);
    runs.push(res);
    console.log(`  run ${i + 1}/${nRuns} gen: ${fmtMs(res.durationMs)} — ${res.chars} chars${res.ok ? '' : ` ERROR: ${res.error}`}`);

    const ts = Date.now();
    await driver.shutdown().catch(() => {});
    shutdownMs += Date.now() - ts;
  }
  initMs = Math.round(initMs / nRuns);
  shutdownMs = Math.round(shutdownMs / nRuns);
  return { name, label, runs, initMs, shutdownMs };
}

async function runPersistent(
  name: string,
  label: string,
  opts: { headless: boolean; intervalMs: number; exe?: string },
  prompt: string,
  nRuns: number,
): Promise<ConfigResult> {
  console.log(`\n[${'─'.repeat(50)}]`);
  console.log(`▶  ${name} (${label})`);
  const runs: RunResult[] = [];

  const driver = makeDriver(opts);
  const t0 = Date.now();
  try {
    await driver.init();
  } catch (e) {
    console.error(`  init failed: ${e}`);
    return { name, label, runs: [{ durationMs: 0, chars: 0, ok: false, error: `init: ${e}` }], initMs: 0, shutdownMs: 0 };
  }
  const initMs = Date.now() - t0;
  console.log(`  init: ${fmtMs(initMs)} (shared across ${nRuns} calls)`);

  for (let i = 0; i < nRuns; i++) {
    const res = await runGenerate(driver, prompt);
    runs.push(res);
    console.log(`  run ${i + 1}/${nRuns} gen: ${fmtMs(res.durationMs)} — ${res.chars} chars${res.ok ? '' : ` ERROR: ${res.error}`}`);
  }

  const ts = Date.now();
  await driver.shutdown().catch(() => {});
  const shutdownMs = Date.now() - ts;
  console.log(`  shutdown: ${fmtMs(shutdownMs)} (shared)`);

  return { name, label, runs, initMs, shutdownMs };
}

// ─── Report ───────────────────────────────────────────────────────────────────

function printReport(results: ConfigResult[], nRuns: number) {
  console.log('\n' + '═'.repeat(80));
  console.log('BENCHMARK RESULTS');
  console.log('═'.repeat(80));

  const COL = [12, 30, 10, 10, 10, 10, 10, 10];
  const header = [
    pad('Config', COL[0]),
    pad('Label', COL[1]),
    pad('Init', COL[2]),
    pad('Gen mean', COL[3]),
    pad('Gen ±', COL[4]),
    pad('Gen min', COL[5]),
    pad('Gen max', COL[6]),
    pad('Chars', COL[7]),
  ].join('');
  console.log(header);
  console.log('─'.repeat(80));

  const baselineGenMean = results[0]?.runs.filter(r => r.ok).map(r => r.durationMs) ?? [];
  const baseMean = baselineGenMean.length ? stats(baselineGenMean).mean : 0;

  for (const cfg of results) {
    const okRuns = cfg.runs.filter(r => r.ok);
    const failedRuns = cfg.runs.filter(r => !r.ok);
    const genTimes = okRuns.map(r => r.durationMs);
    const charVals = okRuns.map(r => r.chars);
    const s = genTimes.length ? stats(genTimes) : null;
    const avgChars = charVals.length ? Math.round(charVals.reduce((a, b) => a + b, 0) / charVals.length) : 0;
    const delta = s && baseMean ? ` (${s.mean < baseMean ? '-' : '+'}${Math.abs(s.mean - baseMean) / 1000 | 0}s)` : '';

    const row = [
      pad(cfg.name, COL[0]),
      pad(cfg.label, COL[1]),
      pad(fmtMs(cfg.initMs), COL[2]),
      pad(s ? fmtMs(s.mean) + delta : 'FAILED', COL[3]),
      pad(s ? `±${fmtMs(s.stddev)}` : '', COL[4]),
      pad(s ? fmtMs(s.min) : '', COL[5]),
      pad(s ? fmtMs(s.max) : '', COL[6]),
      pad(String(avgChars), COL[7]),
    ].join('');
    console.log(row);

    if (failedRuns.length) {
      console.log(`  ⚠  ${failedRuns.length}/${nRuns} runs failed`);
      failedRuns.forEach(r => console.log(`     ${r.error}`));
    }
  }

  console.log('═'.repeat(80));

  // Per-N-calls total time comparison (persistent vs ephemeral)
  console.log('\nPER-N-CALLS TOTAL TIME COMPARISON:');
  console.log('(init × N + gen × N + shutdown × N  vs  init×1 + gen×N + shutdown×1)');
  for (const cfg of results) {
    const okRuns = cfg.runs.filter(r => r.ok);
    if (!okRuns.length) continue;
    const genMean = stats(okRuns.map(r => r.durationMs)).mean;
    const ephemeralTotal = (cfg.initMs + genMean + cfg.shutdownMs) * nRuns;
    const persistentTotal = cfg.initMs + genMean * nRuns + cfg.shutdownMs;
    const saved = ephemeralTotal - persistentTotal;
    console.log(`  ${cfg.name}: ephemeral=${fmtMs(ephemeralTotal)} persistent=${fmtMs(persistentTotal)} saved=${fmtMs(saved)} per ${nRuns} calls`);
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

console.log('gbrain-companion benchmark');
console.log(`Slug:         ${SLUG}`);
console.log(`N_RUNS:       ${N_RUNS}`);
console.log(`Skip headless:${SKIP_HEADLESS}`);
console.log(`Skip CfT:     ${SKIP_CFT}`);
console.log(`CFT_EXECUTABLE: ${cftExecutable ?? '(not set)'}`);

// Fetch page content once
console.log('\nFetching page from gbrain...');
const page = await getPage(SLUG);
if (!page) { console.error(`Page not found: ${SLUG}`); process.exit(1); }
const prompt = PROMPT_PREFIX + page.compiled_truth;
console.log(`Content: ${page.compiled_truth.length} chars → prompt ${prompt.length} chars`);

const results: ConfigResult[] = [];

// Config A — baseline
results.push(await runEphemeral('A-baseline', 'headless=false interval=1500 ephemeral', { headless: false, intervalMs: 1500 }, prompt, N_RUNS));

// Config B — fast polling only
results.push(await runEphemeral('B-fast-poll', 'headless=false interval=500 ephemeral', { headless: false, intervalMs: 500 }, prompt, N_RUNS));

// Config C — persistent driver + fast polling
results.push(await runPersistent('C-persistent', 'headless=false interval=500 persistent', { headless: false, intervalMs: 500 }, prompt, N_RUNS));

// Config D/E — headless (optional)
if (!SKIP_HEADLESS) {
  results.push(await runEphemeral('D-headless', 'headless=true interval=500 ephemeral', { headless: true, intervalMs: 500 }, prompt, N_RUNS));
  results.push(await runPersistent('E-hl-persist', 'headless=true interval=500 persistent', { headless: true, intervalMs: 500 }, prompt, N_RUNS));
}

// Config F/G — Chrome for Testing (optional, requires CFT_EXECUTABLE)
if (!SKIP_CFT && cftExecutable) {
  console.log(`\nCFT_EXECUTABLE: ${cftExecutable}`);
  results.push(await runEphemeral('F-cft', 'CfT headless=false interval=500 ephemeral', { headless: false, intervalMs: 500, exe: cftExecutable }, prompt, N_RUNS));
  results.push(await runPersistent('G-cft-persist', 'CfT headless=false interval=500 persistent', { headless: false, intervalMs: 500, exe: cftExecutable }, prompt, N_RUNS));
} else if (!SKIP_CFT && !cftExecutable) {
  console.log('\n[CfT] CFT_EXECUTABLE not set — skipping F/G configs');
}

printReport(results, N_RUNS);

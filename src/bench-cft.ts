/**
 * bench-cft.ts — Google Chrome vs Chrome for Testing 直接比較
 *
 * Group A (baseline): Google Chrome (/Applications/Google Chrome.app) — 就是 49s 平均那個
 * Group B (CfT):      Chrome for Testing 146 (puppeteer, ~/.cache/puppeteer/...)
 *
 * 每次 run 用子 process 執行，完全隔離，避免 Chrome singleton 問題。
 * Worker: src/bench-cft-worker.ts (real file, module resolution works normally)
 *
 * Usage:
 *   N_RUNS=5 \
 *   GEMINI_PROFILE_DIR="~/Library/Application Support/Google/Chrome/Profile 2" \
 *   CHROME_EXECUTABLE="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
 *   CFT_EXECUTABLE="~/.cache/puppeteer/.../Google Chrome for Testing" \
 *   GBRAIN_OTP=xxx \
 *   bun run bench-cft
 */

import { execSync } from 'child_process';
import { mkdtempSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { getPage } from './gbrain-client.ts';

const SLUG = process.env['SLUG'] ?? process.argv[2] ?? 'wiki/projects/super-engine';
const N_RUNS = Number(process.env['N_RUNS'] ?? '5');
const COOLDOWN_MS = Number(process.env['COOLDOWN_MS'] ?? '15000');

const profileDir = process.env['GEMINI_PROFILE_DIR'];
const cftProfileDir = process.env['CFT_PROFILE_DIR'] ?? profileDir; // CfT 專用 profile，fallback 到共用
const chromeExe = process.env['CHROME_EXECUTABLE'];
const cftExe = process.env['CFT_EXECUTABLE'];

if (!profileDir) throw new Error('GEMINI_PROFILE_DIR is not set');
if (!chromeExe) throw new Error('CHROME_EXECUTABLE is not set');
if (!cftExe) throw new Error('CFT_EXECUTABLE is not set');

// ─── Types ────────────────────────────────────────────────────────────────────

interface RunResult {
  initMs: number;
  genMs: number;
  chars: number;
  ok: boolean;
  error?: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtMs(ms: number) { return `${(ms / 1000).toFixed(1)}s`; }

function stats(values: number[]) {
  const n = values.length;
  if (!n) return { mean: 0, stddev: 0, min: 0, max: 0 };
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const stddev = Math.sqrt(values.map(v => (v - mean) ** 2).reduce((a, b) => a + b, 0) / n);
  return { mean, stddev, min: Math.min(...values), max: Math.max(...values) };
}

function pct(a: number, b: number) {
  if (!b) return 'N/A';
  const d = ((a - b) / b) * 100;
  return `${d >= 0 ? '+' : ''}${d.toFixed(1)}%`;
}

// ─── Runner ───────────────────────────────────────────────────────────────────

const srcDir = fileURLToPath(new URL('.', import.meta.url));
const workerPath = join(srcDir, 'bench-cft-worker.ts');
const tmpDir = mkdtempSync(join(tmpdir(), 'bench-cft-'));

async function oneRun(exe: string, profile: string, prompt: string): Promise<RunResult> {
  const outPath = join(tmpDir, `result-${Date.now()}.json`);
  const env: Record<string, string> = {
    ...process.env as Record<string, string>,
    _BENCH_EXE: exe,
    _BENCH_PROFILE: profile,
    _BENCH_PROMPT: prompt,
    _BENCH_OUT: outPath,
  };
  try {
    execSync(`npx tsx "${workerPath}"`, { env, timeout: 180_000, stdio: 'pipe', cwd: srcDir });
    const raw = readFileSync(outPath, 'utf8');
    return JSON.parse(raw) as RunResult;
  } catch (e: unknown) {
    let msg = e instanceof Error ? e.message : String(e);
    if (e && typeof e === 'object' && 'stderr' in e) {
      const stderr = (e as { stderr: Buffer | string }).stderr;
      const stderrStr = Buffer.isBuffer(stderr) ? stderr.toString('utf8') : String(stderr);
      if (stderrStr.trim()) msg = stderrStr.slice(0, 500);
    }
    return { initMs: 0, genMs: 0, chars: 0, ok: false, error: msg };
  }
}

async function runGroup(label: string, exe: string, profile: string, prompt: string, n: number): Promise<RunResult[]> {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`Group: ${label}`);
  console.log(`exe:   .../${exe.split('/').slice(-1)[0]}`);
  console.log('─'.repeat(60));

  const results: RunResult[] = [];
  for (let i = 0; i < n; i++) {
    const res = await oneRun(exe, profile, prompt);
    const total = res.initMs + res.genMs;
    console.log(`  [${i + 1}/${n}] init=${fmtMs(res.initMs)} gen=${fmtMs(res.genMs)} total=${fmtMs(total)} chars=${res.chars}${res.ok ? '' : ` ERR: ${res.error?.slice(0, 120)}`}`);
    results.push(res);
    if (i < n - 1) {
      process.stdout.write(`  cooldown ${COOLDOWN_MS / 1000}s...`);
      await new Promise(r => setTimeout(r, COOLDOWN_MS));
      process.stdout.write('\r' + ' '.repeat(30) + '\r');
    }
  }
  return results;
}

// ─── Report ───────────────────────────────────────────────────────────────────

function report(label: string, results: RunResult[]) {
  const ok = results.filter(r => r.ok);
  if (!ok.length) return null;
  return {
    label,
    n: ok.length,
    initS: stats(ok.map(r => r.initMs)),
    genS:  stats(ok.map(r => r.genMs)),
    totalS: stats(ok.map(r => r.initMs + r.genMs)),
    charS:  stats(ok.map(r => r.chars)),
  };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

console.log('gbrain-companion: Google Chrome vs Chrome for Testing 146');
console.log(`Slug:     ${SLUG}`);
console.log(`N_RUNS:   ${N_RUNS}`);
console.log(`Cooldown: ${COOLDOWN_MS / 1000}s between runs`);
console.log(`Chrome:   ${chromeExe}`);
console.log(`CfT:      ${cftExe}`);

console.log('\nFetching page from gbrain...');
const page = await getPage(SLUG);
if (!page) { console.error(`Page not found: ${SLUG}`); process.exit(1); }
const prompt = `請用繁體中文摘要以下內容，至少200字：\n\n${page.compiled_truth}`;
console.log(`Prompt: ${prompt.length} chars`);

const groupA = await runGroup('Google Chrome (baseline)', chromeExe, profileDir!, prompt, N_RUNS);
const groupB = await runGroup('Chrome for Testing 146', cftExe, cftProfileDir!, prompt, N_RUNS);

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log('\n' + '═'.repeat(70));
console.log('RESULTS');
console.log('═'.repeat(70));

const rA = report('Google Chrome', groupA);
const rB = report('Chrome for Testing 146', groupB);

if (rA && rB) {
  const w = [22, 18, 22, 14];
  const fmt = (r: string[]) => r.map((c, i) => c.padEnd(w[i])).join(' | ');
  const h = fmt(['指標', 'Google Chrome', 'Chrome for Testing', 'CfT vs Chrome']);
  console.log(h);
  console.log('─'.repeat(h.length));

  const rows = [
    ['Driver 啟動 (init)', fmtMs(rA.initS.mean), fmtMs(rB.initS.mean), pct(rB.initS.mean, rA.initS.mean)],
    ['Init ±stddev',       `±${fmtMs(rA.initS.stddev)}`, `±${fmtMs(rB.initS.stddev)}`, '—'],
    ['Gen time (mean)',    fmtMs(rA.genS.mean),  fmtMs(rB.genS.mean),  pct(rB.genS.mean, rA.genS.mean)],
    ['Gen ±stddev',       `±${fmtMs(rA.genS.stddev)}`, `±${fmtMs(rB.genS.stddev)}`, '—'],
    ['端到端 (mean)',      fmtMs(rA.totalS.mean), fmtMs(rB.totalS.mean), pct(rB.totalS.mean, rA.totalS.mean)],
    ['端到端 (min)',       fmtMs(rA.totalS.min),  fmtMs(rB.totalS.min),  pct(rB.totalS.min, rA.totalS.min)],
    ['端到端 (max)',       fmtMs(rA.totalS.max),  fmtMs(rB.totalS.max),  pct(rB.totalS.max, rA.totalS.max)],
    ['輸出字數 (mean)',    String(Math.round(rA.charS.mean)), String(Math.round(rB.charS.mean)), '—'],
    ['成功次數',           `${rA.n}/${N_RUNS}`,   `${rB.n}/${N_RUNS}`,   '—'],
  ];
  rows.forEach(r => console.log(fmt(r)));
  console.log('═'.repeat(70));

  const endDiff = ((rB.totalS.mean - rA.totalS.mean) / rA.totalS.mean) * 100;
  console.log('\n判定：');
  if      (endDiff <= -20) console.log(`✅ CfT 快 ${Math.abs(endDiff).toFixed(1)}% → 改為預設 (達到 ≥20% 門檻)`);
  else if (endDiff < -10)  console.log(`⚠️  CfT 快 ${Math.abs(endDiff).toFixed(1)}% → 留 .env 選項，不改預設 (未達 20%)`);
  else if (endDiff < 10)   console.log(`➡️  無顯著差異 (${endDiff.toFixed(1)}%) → 留 .env 選項，不改預設`);
  else                     console.log(`❌ CfT 反而慢 ${endDiff.toFixed(1)}% → 保留現狀`);

  const json = {
    date: new Date().toISOString().slice(0, 10),
    n_runs: N_RUNS,
    google_chrome: { init_mean_ms: rA.initS.mean, gen_mean_ms: rA.genS.mean, total_mean_ms: rA.totalS.mean, n: rA.n },
    cft_146:       { init_mean_ms: rB.initS.mean, gen_mean_ms: rB.genS.mean, total_mean_ms: rB.totalS.mean, n: rB.n },
    end_to_end_pct_delta: endDiff,
  };
  console.log('\nJSON result:\n' + JSON.stringify(json, null, 2));
} else {
  console.log('Not enough successful runs to compare.');
  console.log('Group A failures:', groupA.filter(r => !r.ok).map(r => r.error?.slice(0, 200)));
  console.log('Group B failures:', groupB.filter(r => !r.ok).map(r => r.error?.slice(0, 200)));
}

/**
 * bench-baseline.ts — Phase 0: persistent driver, 5 fixed slugs × N rounds, newConversation: true
 *
 * Measurements per slug per round:
 *   gen_ms  = driver.generate() wall time
 *   chars   = output length
 *
 * One-time:
 *   init_ms = driver.init() wall time
 *
 * Output: median table printed to stdout, JSON written to /tmp, summary written to wiki.
 *
 * Usage:
 *   N_ROUNDS=3 \
 *   GEMINI_PROFILE_DIR="~/Library/Application Support/Google/Chrome/Profile 2" \
 *   CHROME_EXECUTABLE="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
 *   GBRAIN_OTP=xxx \
 *   bun run bench-baseline
 */

import { GeminiWebDriver } from 'weblm-driver';
import { writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { getPage, putPage } from './gbrain-client.ts';

// ─── Config ───────────────────────────────────────────────────────────────────

const SLUGS = [
  'wiki/projects/super-engine',
  'wiki/projects/gbrain-companion/architecture',
  'wiki/projects/gbrain-companion/roadmap',
  'wiki/projects/gbrain-companion/perf/2026-05-17-chrome-for-testing-comparison',
  'wiki/identity/gbrain-system-prompt-v4',
];

const N_ROUNDS  = Number(process.env['N_ROUNDS']  ?? '3');
const profileDir    = process.env['GEMINI_PROFILE_DIR'];
const executablePath = process.env['CHROME_EXECUTABLE'];
const headless      = process.env['HEADLESS'] === 'true';
const PHASE         = process.env['PHASE'] ?? '0';           // label for wiki page
const WIKI_SLUG     = process.env['WIKI_SLUG'] ??
  `wiki/projects/gbrain-companion/perf/${new Date().toISOString().slice(0, 10)}-phase${PHASE}-baseline`;

if (!profileDir) throw new Error('GEMINI_PROFILE_DIR is not set');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtMs(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function mean(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function stddev(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  return Math.sqrt(values.map(v => (v - m) ** 2).reduce((a, b) => a + b, 0) / values.length);
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface RunRecord {
  round: number;
  slug: string;
  genMs: number;
  chars: number;
  ok: boolean;
  error?: string;
}

interface SlugStats {
  slug: string;
  promptChars: number;
  genMedianMs: number;
  genMeanMs: number;
  genStddevMs: number;
  charMedian: number;
  okRuns: number;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

console.log(`\n${'═'.repeat(60)}`);
console.log(`bench-baseline — Phase ${PHASE}`);
console.log(`Slugs:   ${SLUGS.length}`);
console.log(`Rounds:  ${N_ROUNDS}`);
console.log(`Profile: ${profileDir}`);
console.log(`Exe:     ${executablePath ?? '(default)'}`);
console.log(`Headless: ${headless}`);
console.log('═'.repeat(60));

// Fetch all pages upfront
console.log('\nFetching pages from gbrain...');
const pages: Array<{ slug: string; prompt: string; promptChars: number }> = [];
for (const slug of SLUGS) {
  const page = await getPage(slug);
  if (!page) {
    console.warn(`  ⚠ Page not found: ${slug} — skipping`);
    continue;
  }
  const prompt = `請用繁體中文摘要以下內容，至少200字：\n\n${page.compiled_truth}`;
  pages.push({ slug, prompt, promptChars: prompt.length });
  console.log(`  ✓ ${slug} (${prompt.length} chars)`);
}

if (!pages.length) {
  console.error('No pages loaded, aborting.');
  process.exit(1);
}

// Init driver (one-time)
const driver = new GeminiWebDriver({
  providerUrl: 'https://gemini.google.com/app',
  profileDir: profileDir!,
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

console.log('\nInitialising driver...');
const t0 = Date.now();
await driver.init();
const initMs = Date.now() - t0;
console.log(`  init=${fmtMs(initMs)}`);

// Run rounds
const records: RunRecord[] = [];

for (let round = 1; round <= N_ROUNDS; round++) {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`Round ${round}/${N_ROUNDS}`);
  console.log('─'.repeat(60));

  for (const { slug, prompt } of pages) {
    const tg = Date.now();
    try {
      const result = await driver.generate({ prompt, timeoutMs: 90_000, newConversation: true });
      const genMs = Date.now() - tg;
      const chars = result.text.length;
      const ok = result.outputKind === 'normal';
      console.log(`  [R${round}] ${slug.split('/').pop()} → gen=${fmtMs(genMs)} chars=${chars}${ok ? '' : ` [${result.outputKind}]`}`);
      records.push({ round, slug, genMs, chars, ok });
    } catch (e) {
      const genMs = Date.now() - tg;
      const error = String(e).slice(0, 200);
      console.log(`  [R${round}] ${slug.split('/').pop()} → ERR ${error.slice(0, 80)}`);
      records.push({ round, slug, genMs: 0, chars: 0, ok: false, error });
    }
  }
}

await driver.shutdown().catch(() => {});

// ─── Aggregate ────────────────────────────────────────────────────────────────

const slugStats: SlugStats[] = pages.map(({ slug, promptChars }) => {
  const ok = records.filter(r => r.slug === slug && r.ok);
  const genMss = ok.map(r => r.genMs);
  const charss = ok.map(r => r.chars);
  return {
    slug,
    promptChars,
    genMedianMs: median(genMss),
    genMeanMs:   mean(genMss),
    genStddevMs: stddev(genMss),
    charMedian:  median(charss),
    okRuns: ok.length,
  };
});

const allGenMss  = records.filter(r => r.ok).map(r => r.genMs);
const overallMedian = median(allGenMss);
const overallMean   = mean(allGenMss);

// ─── Report ───────────────────────────────────────────────────────────────────

console.log(`\n${'═'.repeat(70)}`);
console.log('RESULTS — Phase 0 Baseline (newConversation: true, persistent driver)');
console.log('═'.repeat(70));
console.log(`init_ms (one-time): ${fmtMs(initMs)}\n`);

const hdr = ['Slug (tail)', 'Prompt', 'Gen median', 'Gen mean', '±stddev', 'Chars', 'OK'].map((h, i) =>
  h.padEnd([20, 8, 10, 10, 8, 6, 4][i]!)
).join(' | ');
console.log(hdr);
console.log('─'.repeat(hdr.length));

for (const s of slugStats) {
  const row = [
    s.slug.split('/').pop()!.slice(0, 20),
    String(s.promptChars),
    fmtMs(s.genMedianMs),
    fmtMs(s.genMeanMs),
    `±${fmtMs(s.genStddevMs)}`,
    String(Math.round(s.charMedian)),
    `${s.okRuns}/${N_ROUNDS}`,
  ].map((v, i) => v.padEnd([20, 8, 10, 10, 8, 6, 4][i]!)).join(' | ');
  console.log(row);
}

console.log('─'.repeat(hdr.length));
console.log(`Overall gen median: ${fmtMs(overallMedian)}   mean: ${fmtMs(overallMean)}`);
console.log('═'.repeat(70));

// ─── JSON output ──────────────────────────────────────────────────────────────

const jsonResult = {
  date: new Date().toISOString().slice(0, 10),
  phase: PHASE,
  n_rounds: N_ROUNDS,
  init_ms: initMs,
  overall_gen_median_ms: overallMedian,
  overall_gen_mean_ms: overallMean,
  slugs: slugStats.map(s => ({
    slug: s.slug,
    prompt_chars: s.promptChars,
    gen_median_ms: s.genMedianMs,
    gen_mean_ms: Math.round(s.genMeanMs),
    gen_stddev_ms: Math.round(s.genStddevMs),
    char_median: Math.round(s.charMedian),
    ok_runs: s.okRuns,
    n_rounds: N_ROUNDS,
  })),
};

const tmpPath = join(tmpdir(), `bench-phase${PHASE}-${Date.now()}.json`);
writeFileSync(tmpPath, JSON.stringify(jsonResult, null, 2));
console.log(`\nJSON saved: ${tmpPath}`);

// ─── Wiki write ───────────────────────────────────────────────────────────────

const today = new Date().toISOString().slice(0, 10);
const tableRows = slugStats.map(s =>
  `| \`${s.slug.split('/').slice(-1)[0]}\` | ${s.promptChars} | ${fmtMs(s.genMedianMs)} | ${fmtMs(s.genMeanMs)} | ±${fmtMs(s.genStddevMs)} | ${Math.round(s.charMedian)} | ${s.okRuns}/${N_ROUNDS} |`
).join('\n');

const wikiContent = `---
title: Phase ${PHASE} Baseline — gen時間 benchmark ${today}
type: analysis
tags: [benchmark, gbrain-companion, perf, source:ai, phase:${PHASE}]
source: ai
date: ${today}
ai_confidence: high
---

# Phase ${PHASE} Baseline — gen 時間 benchmark

**newConversation: true，persistent driver（init 一次，N 次 generate）**

## 環境

| 項目 | 值 |
|---|---|
| 日期 | ${today} |
| Rounds | ${N_ROUNDS} |
| Slugs | ${pages.length} |
| init_ms | ${fmtMs(initMs)} |
| Driver | GeminiWebDriver（Playwright） |
| newConversation | true |
| stabilityIntervalMs | 500ms |

## 結果

| Slug | Prompt chars | Gen median | Gen mean | ±stddev | Chars | OK |
|---|---|---|---|---|---|---|
${tableRows}
| **Overall** | — | **${fmtMs(overallMedian)}** | **${fmtMs(overallMean)}** | — | — | — |

## 原始 JSON

\`\`\`json
${JSON.stringify(jsonResult, null, 2)}
\`\`\`

## 說明

- **init_ms**：只計一次（persistent driver）
- **gen_ms**：每次 \`driver.generate()\` 的壁鐘時間，包含 newConversation reload（~15-20s）
- **median** 優先（3 輪中位數，排除偶發 outlier）
- 本頁數據為 Phase 1（移除 newConversation）的比較基準
`;

try {
  await putPage(WIKI_SLUG, wikiContent);
  console.log(`\nWiki written: ${WIKI_SLUG}`);
} catch (e) {
  console.warn(`\nWiki write failed: ${e}`);
}

console.log('\nDone.');

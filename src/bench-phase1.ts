/**
 * bench-phase1.ts — Phase 1: persistent driver, newConversation: false + soft reset prefix
 *
 * Hypothesis: skipping page reload saves ~15-20s per generate call.
 * Expected gen_ms: ~8s (vs Phase 0 baseline ~24.4s).
 *
 * Same 5 slugs × N rounds as bench-baseline.ts.
 * Outputs median table + quality check (chars variance vs Phase 0).
 *
 * Usage:
 *   N_ROUNDS=3 \
 *   GEMINI_PROFILE_DIR="~/Library/Application Support/Google/Chrome/Profile 2" \
 *   CHROME_EXECUTABLE="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
 *   GBRAIN_OTP=xxx \
 *   bun run bench-phase1
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

// Phase 0 baseline chars median (for quality comparison)
const PHASE0_CHAR_MEDIANS: Record<string, number> = {
  'wiki/projects/super-engine': 941,
  'wiki/projects/gbrain-companion/architecture': 750,
  'wiki/projects/gbrain-companion/roadmap': 716,
  'wiki/projects/gbrain-companion/perf/2026-05-17-chrome-for-testing-comparison': 771,
  'wiki/identity/gbrain-system-prompt-v4': 867,
};

const N_ROUNDS    = Number(process.env['N_ROUNDS'] ?? '3');
const profileDir  = process.env['GEMINI_PROFILE_DIR'];
const executablePath = process.env['CHROME_EXECUTABLE'];
const headless    = process.env['HEADLESS'] === 'true';
const WIKI_SLUG   = process.env['WIKI_SLUG'] ??
  `wiki/projects/gbrain-companion/perf/${new Date().toISOString().slice(0, 10)}-phase1-no-new-conversation`;

// Soft reset prefix — tells Gemini this is a new independent task without reloading the page
const SOFT_RESET_PREFIX = '[新任務，請忽略上一個對話]\n\n';

if (!profileDir) throw new Error('GEMINI_PROFILE_DIR is not set');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtMs(ms: number): string { return `${(ms / 1000).toFixed(1)}s`; }

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

function pctDiff(a: number, b: number): string {
  if (!b) return 'N/A';
  const d = ((a - b) / b) * 100;
  return `${d >= 0 ? '+' : ''}${d.toFixed(1)}%`;
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

// ─── Main ─────────────────────────────────────────────────────────────────────

console.log(`\n${'═'.repeat(60)}`);
console.log('bench-phase1 — newConversation: false + soft reset prefix');
console.log(`Slugs:    ${SLUGS.length}`);
console.log(`Rounds:   ${N_ROUNDS}`);
console.log(`Profile:  ${profileDir}`);
console.log(`Exe:      ${executablePath ?? '(default)'}`);
console.log(`Headless: ${headless}`);
console.log('═'.repeat(60));

// Fetch all pages upfront
console.log('\nFetching pages from gbrain...');
const pages: Array<{ slug: string; prompt: string; promptChars: number }> = [];
for (const slug of SLUGS) {
  const page = await getPage(slug);
  if (!page) { console.warn(`  ⚠ Page not found: ${slug} — skipping`); continue; }
  const prompt = SOFT_RESET_PREFIX + `請用繁體中文摘要以下內容，至少200字：\n\n${page.compiled_truth}`;
  pages.push({ slug, prompt, promptChars: prompt.length });
  console.log(`  ✓ ${slug} (${prompt.length} chars, +${SOFT_RESET_PREFIX.length} prefix)`);
}

if (!pages.length) { console.error('No pages loaded, aborting.'); process.exit(1); }

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
      // KEY CHANGE: newConversation: false — no page reload
      const result = await driver.generate({ prompt, timeoutMs: 90_000, newConversation: false });
      const genMs = Date.now() - tg;
      const chars = result.text.length;
      const ok = result.outputKind === 'normal';
      const p0chars = PHASE0_CHAR_MEDIANS[slug] ?? 0;
      const charDiff = p0chars ? pctDiff(chars, p0chars) : '?';
      const quality = p0chars && Math.abs(chars - p0chars) / p0chars > 0.2 ? ' ⚠️ quality?' : '';
      console.log(`  [R${round}] ${slug.split('/').pop()} → gen=${fmtMs(genMs)} chars=${chars}(${charDiff} vs P0)${quality}${ok ? '' : ` [${result.outputKind}]`}`);
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

const PHASE0_GEN_MEDIANS: Record<string, number> = {
  'wiki/projects/super-engine': 24900,
  'wiki/projects/gbrain-companion/architecture': 23800,
  'wiki/projects/gbrain-companion/roadmap': 23700,
  'wiki/projects/gbrain-companion/perf/2026-05-17-chrome-for-testing-comparison': 24300,
  'wiki/identity/gbrain-system-prompt-v4': 24700,
};

const slugStats = pages.map(({ slug, promptChars }) => {
  const ok = records.filter(r => r.slug === slug && r.ok);
  const genMss = ok.map(r => r.genMs);
  const charss = ok.map(r => r.chars);
  const genMed = median(genMss);
  const p0med = PHASE0_GEN_MEDIANS[slug] ?? 0;
  return {
    slug,
    promptChars,
    genMedianMs: genMed,
    genMeanMs: mean(genMss),
    genStddevMs: stddev(genMss),
    charMedian: median(charss),
    genDeltaPct: p0med ? pctDiff(genMed, p0med) : 'N/A',
    okRuns: ok.length,
  };
});

const allGenMss = records.filter(r => r.ok).map(r => r.genMs);
const overallMedian = median(allGenMss);
const overallMean = mean(allGenMss);
const p0overall = 24400;

// ─── Report ───────────────────────────────────────────────────────────────────

console.log(`\n${'═'.repeat(75)}`);
console.log('RESULTS — Phase 1 (newConversation: false + soft reset prefix)');
console.log(`vs Phase 0 baseline: gen median 24.4s`);
console.log('═'.repeat(75));
console.log(`init_ms (one-time): ${fmtMs(initMs)}\n`);

const cols = [20, 8, 10, 10, 8, 6, 10, 4];
const hdr = ['Slug (tail)', 'Prompt', 'Gen median', 'Gen mean', '±stddev', 'Chars', 'vs P0', 'OK']
  .map((h, i) => h.padEnd(cols[i]!)).join(' | ');
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
    s.genDeltaPct,
    `${s.okRuns}/${N_ROUNDS}`,
  ].map((v, i) => v.padEnd(cols[i]!)).join(' | ');
  console.log(row);
}
console.log('─'.repeat(hdr.length));
console.log(`Overall gen median: ${fmtMs(overallMedian)}   mean: ${fmtMs(overallMean)}   vs P0: ${pctDiff(overallMedian, p0overall)}`);
console.log('═'.repeat(75));

// Verdict
const deltaPct = ((overallMedian - p0overall) / p0overall) * 100;
console.log('\n判定：');
if      (deltaPct <= -20) console.log(`✅ Phase 1 快 ${Math.abs(deltaPct).toFixed(1)}% → 採用 newConversation: false 為預設`);
else if (deltaPct < -10)  console.log(`⚠️  Phase 1 快 ${Math.abs(deltaPct).toFixed(1)}% → 有效但未達 20%，考慮採用`);
else if (deltaPct < 10)   console.log(`➡️  無顯著差異 (${deltaPct.toFixed(1)}%) → 保留現狀`);
else                      console.log(`❌ Phase 1 反而慢 ${deltaPct.toFixed(1)}% → 放棄`);

// JSON
const jsonResult = {
  date: new Date().toISOString().slice(0, 10),
  phase: '1',
  n_rounds: N_ROUNDS,
  init_ms: initMs,
  overall_gen_median_ms: overallMedian,
  overall_gen_mean_ms: overallMean,
  phase0_overall_median_ms: p0overall,
  delta_pct: Number(deltaPct.toFixed(2)),
  slugs: slugStats.map(s => ({
    slug: s.slug,
    prompt_chars: s.promptChars,
    gen_median_ms: s.genMedianMs,
    gen_mean_ms: Math.round(s.genMeanMs),
    gen_stddev_ms: Math.round(s.genStddevMs),
    char_median: Math.round(s.charMedian),
    gen_delta_pct: s.genDeltaPct,
    ok_runs: s.okRuns,
    n_rounds: N_ROUNDS,
  })),
};

const tmpPath = join(tmpdir(), `bench-phase1-${Date.now()}.json`);
writeFileSync(tmpPath, JSON.stringify(jsonResult, null, 2));
console.log(`\nJSON saved: ${tmpPath}`);

// Wiki write
const today = new Date().toISOString().slice(0, 10);
const tableRows = slugStats.map(s =>
  `| \`${s.slug.split('/').slice(-1)[0]}\` | ${s.promptChars} | ${fmtMs(s.genMedianMs)} | ${fmtMs(s.genMeanMs)} | ±${fmtMs(s.genStddevMs)} | ${Math.round(s.charMedian)} | ${s.genDeltaPct} | ${s.okRuns}/${N_ROUNDS} |`
).join('\n');

const verdictLine = deltaPct <= -20
  ? `✅ **採用** — Phase 1 快 ${Math.abs(deltaPct).toFixed(1)}%，移除 newConversation: true`
  : deltaPct < -10
    ? `⚠️ **考慮採用** — Phase 1 快 ${Math.abs(deltaPct).toFixed(1)}%，未達 20% 門檻`
    : deltaPct < 10
      ? `➡️ **無顯著差異** — ${deltaPct.toFixed(1)}%，保留現狀`
      : `❌ **放棄** — Phase 1 反而慢 ${deltaPct.toFixed(1)}%`;

const wikiContent = `---
title: Phase 1 — newConversation:false 測試 ${today}
type: analysis
tags: [benchmark, gbrain-companion, perf, source:ai, phase:1]
source: ai
date: ${today}
ai_confidence: high
---

# Phase 1 — newConversation: false + soft reset prefix

**假說：移除頁面重載（newConversation: true），每次 generate 節省 ~15-20s。**

## 判定

${verdictLine}

Phase 0 baseline: **24.4s** → Phase 1: **${fmtMs(overallMedian)}** (${pctDiff(overallMedian, p0overall)})

## 環境

| 項目 | 值 |
|---|---|
| 日期 | ${today} |
| Rounds | ${N_ROUNDS} |
| Slugs | ${pages.length} |
| init_ms | ${fmtMs(initMs)} |
| Driver | GeminiWebDriver（Playwright） |
| newConversation | **false** |
| Soft reset prefix | \`[新任務，請忽略上一個對話]\` |
| stabilityIntervalMs | 500ms |

## 結果

| Slug | Prompt | Gen median | Gen mean | ±stddev | Chars | vs P0 | OK |
|---|---|---|---|---|---|---|---|
${tableRows}
| **Overall** | — | **${fmtMs(overallMedian)}** | **${fmtMs(overallMean)}** | — | — | **${pctDiff(overallMedian, p0overall)}** | — |

## Phase 0 vs Phase 1 比較

| 指標 | Phase 0 (newConversation: true) | Phase 1 (newConversation: false) | Δ |
|---|---|---|---|
| gen median | 24.4s | ${fmtMs(overallMedian)} | ${pctDiff(overallMedian, p0overall)} |
| init (one-time) | 19.7s | ${fmtMs(initMs)} | — |

## 原始 JSON

\`\`\`json
${JSON.stringify(jsonResult, null, 2)}
\`\`\`

## 說明

- **soft reset prefix** = \`[新任務，請忽略上一個對話]\\n\\n\`，每次 generate 前綴，告訴 Gemini 這是新任務
- **newConversation: false** = 不重新導覽頁面，在同一個對話繼續發送
- Phase 0 baseline: [2026-05-17-phase0-baseline](2026-05-17-phase0-baseline)
`;

try {
  await putPage(WIKI_SLUG, wikiContent);
  console.log(`\nWiki written: ${WIKI_SLUG}`);
} catch (e) {
  console.warn(`\nWiki write failed: ${e}`);
}

console.log('\nDone.');

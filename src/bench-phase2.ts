/**
 * bench-phase2.ts — Phase 2: expanded Chrome args
 *
 * Base: Phase 1 (newConversation:false + soft reset prefix, gen median ~10.4s)
 * Change: add 11 extra Chrome startup flags (from Project Golem)
 *         merge AutoplayPolicy into combined --disable-features
 *
 * Expected: init_ms -1~3s (15-17s), gen_ms unchanged (~10.4s)
 *
 * Usage:
 *   N_ROUNDS=3 GEMINI_PROFILE_DIR=... CHROME_EXECUTABLE=... GBRAIN_OTP=... bun run bench-phase2
 */

import { GeminiWebDriver } from 'weblm-driver';
import { writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { getPage, putPage } from './gbrain-client.ts';
import {
  SLUGS, SOFT_RESET_PREFIX, PHASE0, PHASE1,
  fmtMs, median, mean, stddev, pctDiff, slugTail, aggregateSlugs,
  type RunRecord,
} from './bench-shared.ts';

const N_ROUNDS     = Number(process.env['N_ROUNDS'] ?? '3');
const profileDir   = process.env['GEMINI_PROFILE_DIR'];
const executablePath = process.env['CHROME_EXECUTABLE'];
const headless     = process.env['HEADLESS'] === 'true';
const TODAY        = new Date().toISOString().slice(0, 10);
const WIKI_SLUG    = `wiki/projects/gbrain-companion/perf/${TODAY}-phase2-extra-args`;

if (!profileDir) throw new Error('GEMINI_PROFILE_DIR is not set');

// ─── Phase 2 args ─────────────────────────────────────────────────────────────
// Phase 1 had 4 args. Phase 2 adds 11, merges --disable-features.

const ARGS_PHASE2 = [
  // Kept from Phase 1
  '--no-first-run',
  '--disable-session-crashed-bubble',
  '--blink-settings=imagesEnabled=false',
  // New / merged (AutoplayPolicy merged in below)
  '--disable-background-networking',
  '--disable-sync',
  '--disable-translate',
  '--disable-default-apps',
  '--disable-extensions',
  '--disable-component-update',
  '--disable-notifications',
  '--no-default-browser-check',
  '--mute-audio',
  // Merged: original AutoplayPolicy + new flags
  '--disable-features=IsolateOrigins,site-per-process,AutomationControlled,AutoplayPolicy',
  '--renderer-process-limit=1',
];

// ─── Main ─────────────────────────────────────────────────────────────────────

console.log(`\n${'═'.repeat(65)}`);
console.log('bench-phase2 — Phase 1 base + expanded Chrome args (11 extra)');
console.log(`Slugs:    ${SLUGS.length}  |  Rounds: ${N_ROUNDS}`);
console.log(`Args:     ${ARGS_PHASE2.length} (Phase 1 had 4)`);
console.log('═'.repeat(65));

console.log('\nFetching pages...');
const pages: Array<{ slug: string; prompt: string; promptChars: number }> = [];
for (const slug of SLUGS) {
  const page = await getPage(slug);
  if (!page) { console.warn(`  ⚠ ${slug} not found`); continue; }
  const prompt = SOFT_RESET_PREFIX + `請用繁體中文摘要以下內容，至少200字：\n\n${page.compiled_truth}`;
  pages.push({ slug, prompt, promptChars: prompt.length });
  console.log(`  ✓ ${slug} (${prompt.length} chars)`);
}
if (!pages.length) { console.error('No pages loaded.'); process.exit(1); }

const driver = new GeminiWebDriver({
  providerUrl: 'https://gemini.google.com/app',
  profileDir: profileDir!,
  ...(executablePath ? { executablePath } : {}),
  headless,
  firstTokenTimeoutMs: 30_000,
  stabilityTimeoutMs: 120_000,
  stabilityIntervalMs: 500,
  args: ARGS_PHASE2,
});

console.log('\nInitialising driver...');
const t0 = Date.now();
await driver.init();
const initMs = Date.now() - t0;
console.log(`  init=${fmtMs(initMs)}  (P1 was 18.2s, P0 was 19.7s)`);

const records: RunRecord[] = [];

for (let round = 1; round <= N_ROUNDS; round++) {
  console.log(`\n${'─'.repeat(65)}`);
  console.log(`Round ${round}/${N_ROUNDS}`);
  console.log('─'.repeat(65));

  for (const { slug, prompt } of pages) {
    const tg = Date.now();
    try {
      const result = await driver.generate({ prompt, timeoutMs: 90_000, newConversation: false });
      const genMs = Date.now() - tg;
      const chars = result.text.length;
      const ok = result.outputKind === 'normal';
      const p1chars = PHASE1.slugMedians[slug]?.chars ?? 0;
      const charDiff = p1chars ? pctDiff(chars, p1chars) : '?';
      const warn = p1chars && Math.abs(chars - p1chars) / p1chars > 0.2 ? ' ⚠️' : '';
      console.log(`  [R${round}] ${slugTail(slug)} → gen=${fmtMs(genMs)} chars=${chars}(${charDiff} vs P1)${warn}`);
      records.push({ round, slug, genMs, chars, ok });
    } catch (e) {
      console.log(`  [R${round}] ${slugTail(slug)} → ERR ${String(e).slice(0, 80)}`);
      records.push({ round, slug, genMs: 0, chars: 0, ok: false, error: String(e).slice(0, 200) });
    }
  }
}

await driver.shutdown().catch(() => {});

// ─── Results ──────────────────────────────────────────────────────────────────

const slugStats = aggregateSlugs(pages, records, N_ROUNDS);
const allGenMss = records.filter(r => r.ok).map(r => r.genMs);
const overallMedian = median(allGenMss);

console.log(`\n${'═'.repeat(75)}`);
console.log('RESULTS — Phase 2 (extra Chrome args)');
console.log(`P1 baseline: init 18.2s  gen median 10.4s`);
console.log('═'.repeat(75));
console.log(`init_ms: ${fmtMs(initMs)}  (vs P1 18.2s → ${pctDiff(initMs, 18200)})\n`);

const cols = [20, 8, 10, 10, 8, 6, 10, 4];
const hdr = ['Slug', 'Prompt', 'Gen median', 'Gen mean', '±stddev', 'Chars', 'vs P1', 'OK']
  .map((h, i) => h.padEnd(cols[i]!)).join(' | ');
console.log(hdr);
console.log('─'.repeat(hdr.length));
for (const s of slugStats) {
  const p1med = PHASE1.slugMedians[s.slug]?.genMs ?? 0;
  const row = [
    slugTail(s.slug),
    String(s.promptChars),
    fmtMs(s.genMedianMs),
    fmtMs(s.genMeanMs),
    `±${fmtMs(s.genStddevMs)}`,
    String(Math.round(s.charMedian)),
    p1med ? pctDiff(s.genMedianMs, p1med) : '—',
    `${s.okRuns}/${N_ROUNDS}`,
  ].map((v, i) => v.padEnd(cols[i]!)).join(' | ');
  console.log(row);
}
console.log('─'.repeat(hdr.length));
console.log(`Overall gen median: ${fmtMs(overallMedian)}  vs P1: ${pctDiff(overallMedian, 10400)}`);
console.log('═'.repeat(75));

// Verdict
const initDelta = ((initMs - 18200) / 18200) * 100;
const genDelta  = ((overallMedian - 10400) / 10400) * 100;
console.log('\n判定（Phase 2 init_ms）：');
if      (initDelta <= -5)  console.log(`✅ init 快 ${Math.abs(initDelta).toFixed(1)}% (${fmtMs(18200 - initMs)} 節省) → 採用`);
else if (initDelta <= 0)   console.log(`➡️  init 略快 ${Math.abs(initDelta).toFixed(1)}% → 採用（無損耗）`);
else                       console.log(`❌ init 反而慢 ${initDelta.toFixed(1)}% → 需要二分法找兇手`);
console.log(`gen_ms: ${pctDiff(overallMedian, 10400)} (期望 <±5%)`);

// JSON
const jsonResult = {
  date: TODAY, phase: '2', n_rounds: N_ROUNDS,
  init_ms: initMs,
  overall_gen_median_ms: overallMedian,
  phase1_init_ms: 18200, phase1_gen_median_ms: 10400,
  init_delta_pct: Number(initDelta.toFixed(2)),
  gen_delta_pct: Number(genDelta.toFixed(2)),
  args: ARGS_PHASE2,
  slugs: slugStats.map(s => ({
    slug: s.slug, prompt_chars: s.promptChars,
    gen_median_ms: s.genMedianMs, gen_mean_ms: Math.round(s.genMeanMs),
    gen_stddev_ms: Math.round(s.genStddevMs), char_median: Math.round(s.charMedian),
    ok_runs: s.okRuns,
  })),
};
const tmpPath = join(tmpdir(), `bench-phase2-${Date.now()}.json`);
writeFileSync(tmpPath, JSON.stringify(jsonResult, null, 2));
console.log(`\nJSON: ${tmpPath}`);

// Wiki
const tableRows = slugStats.map(s => {
  const p1med = PHASE1.slugMedians[s.slug]?.genMs ?? 0;
  return `| \`${s.slug.split('/').pop()}\` | ${s.promptChars} | ${fmtMs(s.genMedianMs)} | ${fmtMs(s.genMeanMs)} | ±${fmtMs(s.genStddevMs)} | ${Math.round(s.charMedian)} | ${p1med ? pctDiff(s.genMedianMs, p1med) : '—'} | ${s.okRuns}/${N_ROUNDS} |`;
}).join('\n');

const wikiContent = `---
title: Phase 2 — 擴充 Chrome args benchmark ${TODAY}
type: analysis
tags: [benchmark, gbrain-companion, perf, source:ai, phase:2]
source: ai
date: ${TODAY}
ai_confidence: high
---

# Phase 2 — 擴充 Chrome 啟動 args

**基礎：Phase 1（newConversation:false + soft reset）**
**變因：Chrome args 從 4 個擴充到 ${ARGS_PHASE2.length} 個**

## 判定

init_ms: ${fmtMs(initMs)} vs P1 18.2s → **${pctDiff(initMs, 18200)}**
gen_ms overall median: ${fmtMs(overallMedian)} vs P1 10.4s → **${pctDiff(overallMedian, 10400)}**

${initDelta <= 0 ? '✅ **採用** — init 有改善，gen 不受影響' : '❌ **回退** — init 反而更慢，需要二分法'}

## 環境

| 項目 | Phase 1 | Phase 2 | Δ |
|---|---|---|---|
| init_ms | 18.2s | ${fmtMs(initMs)} | ${pctDiff(initMs, 18200)} |
| gen median | 10.4s | ${fmtMs(overallMedian)} | ${pctDiff(overallMedian, 10400)} |
| args 數量 | 4 | ${ARGS_PHASE2.length} | +${ARGS_PHASE2.length - 4} |

## 新增 args（${ARGS_PHASE2.length - 4} 個）

\`\`\`
${ARGS_PHASE2.slice(3).join('\n')}
\`\`\`

## 結果

| Slug | Prompt | Gen median | Gen mean | ±stddev | Chars | vs P1 | OK |
|---|---|---|---|---|---|---|---|
${tableRows}
| **Overall** | — | **${fmtMs(overallMedian)}** | — | — | — | **${pctDiff(overallMedian, 10400)}** | — |

## 原始 JSON

\`\`\`json
${JSON.stringify(jsonResult, null, 2)}
\`\`\`
`;

try { await putPage(WIKI_SLUG, wikiContent); console.log(`Wiki: ${WIKI_SLUG}`); }
catch (e) { console.warn(`Wiki write failed: ${e}`); }
console.log('\nDone.');

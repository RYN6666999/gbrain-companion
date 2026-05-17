/**
 * bench-phase3.ts — Phase 3: stabilityIntervalMs tuning
 *
 * Base: Phase 2 (newConversation:false + soft reset + expanded args)
 * Change: stabilityIntervalMs 500 → 900
 *         (500 may over-eagerly detect stability during brief Gemini pauses)
 *
 * Expected: gen_ms -0.5~1.5s, text.length stable (<15% cross-round variance)
 *
 * Usage:
 *   N_ROUNDS=3 STABILITY_MS=900 GEMINI_PROFILE_DIR=... CHROME_EXECUTABLE=...
 *   GBRAIN_OTP=... bun run bench-phase3
 */

import { GeminiWebDriver } from 'weblm-driver';
import { writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { getPage, putPage } from './gbrain-client.ts';
import {
  SLUGS, SOFT_RESET_PREFIX, PHASE1,
  fmtMs, median, mean, stddev, pctDiff, slugTail, aggregateSlugs,
  type RunRecord,
} from './bench-shared.ts';

// Phase 2 measured values (filled after Phase 2 run)
// Will be overridden by PHASE2_INIT_MS / PHASE2_GEN_MEDIAN_MS env vars if set
const PHASE2_INIT_MS       = Number(process.env['PHASE2_INIT_MS']    ?? '0');
const PHASE2_GEN_MEDIAN_MS = Number(process.env['PHASE2_GEN_MS']     ?? '10400');

const STABILITY_MS = Number(process.env['STABILITY_MS'] ?? '900');
const N_ROUNDS     = Number(process.env['N_ROUNDS']     ?? '3');
const profileDir   = process.env['GEMINI_PROFILE_DIR'];
const executablePath = process.env['CHROME_EXECUTABLE'];
const headless     = process.env['HEADLESS'] === 'true';
const TODAY        = new Date().toISOString().slice(0, 10);
const WIKI_SLUG    = `wiki/projects/gbrain-companion/perf/${TODAY}-phase3-stability-${STABILITY_MS}`;

if (!profileDir) throw new Error('GEMINI_PROFILE_DIR is not set');

// Phase 2 rejected (extra args caused crashes / no benefit) → revert to Phase 1 args
const ARGS = [
  '--no-first-run',
  '--disable-session-crashed-bubble',
  '--blink-settings=imagesEnabled=false',
  '--disable-features=AutoplayPolicy',
];

// ─── Main ─────────────────────────────────────────────────────────────────────

console.log(`\n${'═'.repeat(65)}`);
console.log(`bench-phase3 — stabilityIntervalMs: ${STABILITY_MS}ms (was 500ms)`);
console.log(`Slugs: ${SLUGS.length}  |  Rounds: ${N_ROUNDS}  |  Args: ${ARGS.length}`);
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
  stabilityIntervalMs: STABILITY_MS,
  args: ARGS,
});

console.log('\nInitialising driver...');
const t0 = Date.now();
await driver.init();
const initMs = Date.now() - t0;
console.log(`  init=${fmtMs(initMs)}`);

const records: RunRecord[] = [];
// Track per-slug chars across rounds for variance check
const charsBySlug: Record<string, number[]> = {};

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
      // Track chars for variance check
      if (!charsBySlug[slug]) charsBySlug[slug] = [];
      charsBySlug[slug]!.push(chars);
      const p1chars = PHASE1.slugMedians[slug]?.chars ?? 0;
      const charDiff = p1chars ? pctDiff(chars, p1chars) : '?';
      const warn = p1chars && Math.abs(chars - p1chars) / p1chars > 0.2 ? ' ⚠️quality?' : '';
      console.log(`  [R${round}] ${slugTail(slug)} → gen=${fmtMs(genMs)} chars=${chars}(${charDiff} vs P1)${warn}`);
      records.push({ round, slug, genMs, chars, ok });
    } catch (e) {
      console.log(`  [R${round}] ${slugTail(slug)} → ERR ${String(e).slice(0, 80)}`);
      records.push({ round, slug, genMs: 0, chars: 0, ok: false, error: String(e).slice(0, 200) });
    }
  }
}

await driver.shutdown().catch(() => {});

// Cross-round chars variance check
console.log('\n── Chars variance check (truncation guard) ──');
let truncationWarning = false;
for (const slug of SLUGS) {
  const chars = charsBySlug[slug] ?? [];
  if (chars.length < 2) continue;
  const minC = Math.min(...chars), maxC = Math.max(...chars);
  const variance = maxC > 0 ? ((maxC - minC) / maxC) * 100 : 0;
  const flag = variance > 15 ? ' ⚠️ VARIANCE >15%' : '';
  if (variance > 15) truncationWarning = true;
  console.log(`  ${slugTail(slug)}: min=${minC} max=${maxC} variance=${variance.toFixed(1)}%${flag}`);
}
if (truncationWarning) {
  console.log('\n⚠️  STABILITY WARNING: chars variance >15% on some slugs.');
  console.log('   Possible truncation at stabilityIntervalMs=' + STABILITY_MS + 'ms.');
  console.log('   Consider increasing to 1000 or 1200ms.\n');
} else {
  console.log('  ✅ All slugs within 15% chars variance — no truncation detected.\n');
}

// ─── Results ──────────────────────────────────────────────────────────────────

const slugStats = aggregateSlugs(pages, records, N_ROUNDS);
const allGenMss = records.filter(r => r.ok).map(r => r.genMs);
const overallMedian = median(allGenMss);

console.log(`${'═'.repeat(75)}`);
console.log(`RESULTS — Phase 3 (stabilityIntervalMs=${STABILITY_MS}ms)`);
console.log(`P2 baseline: gen median ~${fmtMs(PHASE2_GEN_MEDIAN_MS)}`);
console.log('═'.repeat(75));
console.log(`init_ms: ${fmtMs(initMs)}\n`);

const cols = [20, 8, 10, 10, 8, 6, 10, 4];
const hdr = ['Slug', 'Prompt', 'Gen median', 'Gen mean', '±stddev', 'Chars', 'vs P2', 'OK']
  .map((h, i) => h.padEnd(cols[i]!)).join(' | ');
console.log(hdr);
console.log('─'.repeat(hdr.length));
for (const s of slugStats) {
  const p2med = PHASE2_GEN_MEDIAN_MS; // approximate; per-slug not tracked
  const row = [
    slugTail(s.slug),
    String(s.promptChars),
    fmtMs(s.genMedianMs),
    fmtMs(s.genMeanMs),
    `±${fmtMs(s.genStddevMs)}`,
    String(Math.round(s.charMedian)),
    pctDiff(s.genMedianMs, PHASE1.slugMedians[s.slug]?.genMs ?? 10400),
    `${s.okRuns}/${N_ROUNDS}`,
  ].map((v, i) => v.padEnd(cols[i]!)).join(' | ');
  console.log(row);
}
console.log('─'.repeat(hdr.length));
const genDeltaVsP2 = pctDiff(overallMedian, PHASE2_GEN_MEDIAN_MS);
console.log(`Overall gen median: ${fmtMs(overallMedian)}  vs P2: ${genDeltaVsP2}`);
if (truncationWarning) console.log('⚠️  TRUNCATION WARNING — consider reverting or increasing interval');
console.log('═'.repeat(75));

// Verdict
const genDeltaPct = ((overallMedian - PHASE2_GEN_MEDIAN_MS) / PHASE2_GEN_MEDIAN_MS) * 100;
console.log(`\n判定 (stabilityIntervalMs=${STABILITY_MS})：`);
if (truncationWarning) {
  console.log(`❌ 截斷警告 → 回退到 500ms 或試更高值`);
} else if (genDeltaPct < -3) {
  console.log(`✅ gen 快 ${Math.abs(genDeltaPct).toFixed(1)}% → 採用 ${STABILITY_MS}ms`);
} else if (genDeltaPct <= 3) {
  console.log(`➡️  gen 無顯著差異 (${genDeltaPct.toFixed(1)}%) → 採用（不損耗）`);
} else {
  console.log(`❌ gen 慢 ${genDeltaPct.toFixed(1)}% → 回退`);
}

const jsonResult = {
  date: TODAY, phase: '3', stability_ms: STABILITY_MS, n_rounds: N_ROUNDS,
  init_ms: initMs,
  overall_gen_median_ms: overallMedian,
  phase2_gen_median_ms: PHASE2_GEN_MEDIAN_MS,
  gen_delta_pct: Number(genDeltaPct.toFixed(2)),
  truncation_warning: truncationWarning,
  chars_variance: Object.fromEntries(
    Object.entries(charsBySlug).map(([slug, chars]) => {
      const minC = Math.min(...chars), maxC = Math.max(...chars);
      return [slug, { min: minC, max: maxC, variance_pct: maxC > 0 ? +((maxC - minC) / maxC * 100).toFixed(1) : 0 }];
    })
  ),
  slugs: slugStats.map(s => ({
    slug: s.slug, gen_median_ms: s.genMedianMs, gen_mean_ms: Math.round(s.genMeanMs),
    gen_stddev_ms: Math.round(s.genStddevMs), char_median: Math.round(s.charMedian),
    ok_runs: s.okRuns,
  })),
};
const tmpPath = join(tmpdir(), `bench-phase3-${Date.now()}.json`);
writeFileSync(tmpPath, JSON.stringify(jsonResult, null, 2));
console.log(`\nJSON: ${tmpPath}`);

const tableRows = slugStats.map(s =>
  `| \`${s.slug.split('/').pop()}\` | ${s.promptChars} | ${fmtMs(s.genMedianMs)} | ±${fmtMs(s.genStddevMs)} | ${Math.round(s.charMedian)} | ${s.okRuns}/${N_ROUNDS} |`
).join('\n');

const wikiContent = `---
title: Phase 3 — stabilityIntervalMs ${STABILITY_MS}ms benchmark ${TODAY}
type: analysis
tags: [benchmark, gbrain-companion, perf, source:ai, phase:3]
source: ai
date: ${TODAY}
ai_confidence: high
---

# Phase 3 — stabilityIntervalMs ${STABILITY_MS}ms

**基礎：Phase 2（expanded args）**
**變因：stabilityIntervalMs 500 → ${STABILITY_MS}**

## 判定

gen_ms: ${fmtMs(overallMedian)} vs P2 ~${fmtMs(PHASE2_GEN_MEDIAN_MS)} → **${genDeltaVsP2}**
截斷警告：${truncationWarning ? '⚠️ 有（chars variance >15%）' : '✅ 無'}

${truncationWarning ? '❌ **回退** — 截斷警告觸發，interval 不安全' :
  genDeltaPct <= 3 ? `✅ **採用** — 無損耗，${genDeltaPct < -3 ? 'gen 有改善' : 'gen 持平'}` :
  '❌ **回退** — gen 反而更慢'}

## Chars variance（截斷偵測）

| Slug | Min chars | Max chars | Variance |
|---|---|---|---|
${Object.entries(jsonResult.chars_variance).map(([s, v]: [string, any]) =>
  `| \`${s.split('/').pop()}\` | ${v.min} | ${v.max} | ${v.variance_pct}% ${v.variance_pct > 15 ? '⚠️' : '✅'} |`
).join('\n')}

## 結果

| Slug | Prompt | Gen median | ±stddev | Chars | OK |
|---|---|---|---|---|---|
${tableRows}
| **Overall** | — | **${fmtMs(overallMedian)}** | — | — | — |

## 原始 JSON

\`\`\`json
${JSON.stringify(jsonResult, null, 2)}
\`\`\`
`;

try { await putPage(WIKI_SLUG, wikiContent); console.log(`Wiki: ${WIKI_SLUG}`); }
catch (e) { console.warn(`Wiki write failed: ${e}`); }
console.log('\nDone.');

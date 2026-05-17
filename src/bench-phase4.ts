/**
 * bench-phase4.ts — Phase 4: super-engine fork + context.route resource blocking
 *
 * Base: Phase 2+3 (newConversation:false + expanded args + stabilityIntervalMs from P3)
 * Change: blockResources:true → aborts image/media/font requests during init
 *
 * Expected: init_ms -2~5s (from ~15-17s down to ~12-15s), gen_ms unchanged
 *
 * Requires: weblm-driver linked to local super-engine fork with blockResources support
 *   cd ../super-engine && npm link
 *   cd ../gbrain-companion && npm link weblm-driver
 *
 * Usage:
 *   N_ROUNDS=3 STABILITY_MS=900 PHASE3_GEN_MS=xxxx
 *   GEMINI_PROFILE_DIR=... CHROME_EXECUTABLE=... GBRAIN_OTP=... bun run bench-phase4
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

// Values filled in after Phase 2+3 runs (override via env)
const PHASE2_INIT_MS       = Number(process.env['PHASE2_INIT_MS']  ?? '18200');
const PHASE3_GEN_MEDIAN_MS = Number(process.env['PHASE3_GEN_MS']   ?? '10400');
const STABILITY_MS         = Number(process.env['STABILITY_MS']    ?? '900');

const N_ROUNDS     = Number(process.env['N_ROUNDS']     ?? '3');
const profileDir   = process.env['GEMINI_PROFILE_DIR'];
const executablePath = process.env['CHROME_EXECUTABLE'];
const headless     = process.env['HEADLESS'] === 'true';
const TODAY        = new Date().toISOString().slice(0, 10);
const WIKI_SLUG    = `wiki/projects/gbrain-companion/perf/${TODAY}-phase4-route-block`;

if (!profileDir) throw new Error('GEMINI_PROFILE_DIR is not set');

const ARGS = [
  '--no-first-run',
  '--disable-session-crashed-bubble',
  '--blink-settings=imagesEnabled=false',
  '--disable-background-networking',
  '--disable-sync',
  '--disable-translate',
  '--disable-default-apps',
  '--disable-extensions',
  '--disable-component-update',
  '--disable-notifications',
  '--no-default-browser-check',
  '--mute-audio',
  '--disable-features=IsolateOrigins,site-per-process,AutomationControlled,AutoplayPolicy',
  '--renderer-process-limit=1',
];

// ─── Main ─────────────────────────────────────────────────────────────────────

console.log(`\n${'═'.repeat(65)}`);
console.log('bench-phase4 — blockResources:true (image/media/font blocked)');
console.log(`Slugs: ${SLUGS.length}  |  Rounds: ${N_ROUNDS}  |  stabilityMs: ${STABILITY_MS}`);
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
if (!pages.length) { console.error('No pages.'); process.exit(1); }

const driver = new GeminiWebDriver({
  providerUrl: 'https://gemini.google.com/app',
  profileDir: profileDir!,
  ...(executablePath ? { executablePath } : {}),
  headless,
  firstTokenTimeoutMs: 30_000,
  stabilityTimeoutMs: 120_000,
  stabilityIntervalMs: STABILITY_MS,
  args: ARGS,
  blockResources: true,   // ← Phase 4 key change
});

console.log('\nInitialising driver (blockResources:true)...');
const t0 = Date.now();
await driver.init();
const initMs = Date.now() - t0;
console.log(`  init=${fmtMs(initMs)}  (P2 was ~${fmtMs(PHASE2_INIT_MS)}, P0 was 19.7s)`);

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
      const warn = p1chars && Math.abs(chars - p1chars) / p1chars > 0.2 ? ' ⚠️quality?' : '';
      console.log(`  [R${round}] ${slugTail(slug)} → gen=${fmtMs(genMs)} chars=${chars}${warn}${ok ? '' : ` [${result.outputKind}]`}`);
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
const overallGenMedian = median(allGenMss);

console.log(`\n${'═'.repeat(75)}`);
console.log('RESULTS — Phase 4 (blockResources:true)');
console.log(`P2 init baseline: ~${fmtMs(PHASE2_INIT_MS)}   P3 gen baseline: ~${fmtMs(PHASE3_GEN_MEDIAN_MS)}`);
console.log('═'.repeat(75));
console.log(`init_ms: ${fmtMs(initMs)}  (vs P2 ~${fmtMs(PHASE2_INIT_MS)} → ${pctDiff(initMs, PHASE2_INIT_MS)})\n`);

const cols = [20, 8, 10, 10, 8, 6, 4];
const hdr = ['Slug', 'Prompt', 'Gen median', 'Gen mean', '±stddev', 'Chars', 'OK']
  .map((h, i) => h.padEnd(cols[i]!)).join(' | ');
console.log(hdr);
console.log('─'.repeat(hdr.length));
for (const s of slugStats) {
  const row = [
    slugTail(s.slug),
    String(s.promptChars),
    fmtMs(s.genMedianMs),
    fmtMs(s.genMeanMs),
    `±${fmtMs(s.genStddevMs)}`,
    String(Math.round(s.charMedian)),
    `${s.okRuns}/${N_ROUNDS}`,
  ].map((v, i) => v.padEnd(cols[i]!)).join(' | ');
  console.log(row);
}
console.log('─'.repeat(hdr.length));
console.log(`Overall gen median: ${fmtMs(overallGenMedian)}  vs P3: ${pctDiff(overallGenMedian, PHASE3_GEN_MEDIAN_MS)}`);
console.log('═'.repeat(75));

const initDeltaPct = ((initMs - PHASE2_INIT_MS) / PHASE2_INIT_MS) * 100;
const genDeltaPct  = ((overallGenMedian - PHASE3_GEN_MEDIAN_MS) / PHASE3_GEN_MEDIAN_MS) * 100;
console.log('\n判定：');
if      (initDeltaPct <= -10) console.log(`✅ init 快 ${Math.abs(initDeltaPct).toFixed(1)}% (${fmtMs(PHASE2_INIT_MS - initMs)} 節省) → 採用`);
else if (initDeltaPct <= -5)  console.log(`✅ init 快 ${Math.abs(initDeltaPct).toFixed(1)}% → 採用`);
else if (initDeltaPct <= 0)   console.log(`➡️  init 略快 ${Math.abs(initDeltaPct).toFixed(1)}% → 採用（無損耗）`);
else                          console.log(`❌ init 反而慢 ${initDeltaPct.toFixed(1)}% → 需要調查被擋的請求`);
console.log(`gen_ms: ${pctDiff(overallGenMedian, PHASE3_GEN_MEDIAN_MS)} (期望 <±5%)`);

// JSON
const jsonResult = {
  date: TODAY, phase: '4', n_rounds: N_ROUNDS,
  init_ms: initMs,
  overall_gen_median_ms: overallGenMedian,
  phase2_init_ms: PHASE2_INIT_MS,
  phase3_gen_median_ms: PHASE3_GEN_MEDIAN_MS,
  init_delta_pct: Number(initDeltaPct.toFixed(2)),
  gen_delta_pct: Number(genDeltaPct.toFixed(2)),
  stability_ms: STABILITY_MS,
  block_resources: true,
  slugs: slugStats.map(s => ({
    slug: s.slug, gen_median_ms: s.genMedianMs, gen_mean_ms: Math.round(s.genMeanMs),
    gen_stddev_ms: Math.round(s.genStddevMs), char_median: Math.round(s.charMedian),
    ok_runs: s.okRuns,
  })),
};
const tmpPath = join(tmpdir(), `bench-phase4-${Date.now()}.json`);
writeFileSync(tmpPath, JSON.stringify(jsonResult, null, 2));
console.log(`\nJSON: ${tmpPath}`);

const tableRows = slugStats.map(s =>
  `| \`${s.slug.split('/').pop()}\` | ${s.promptChars} | ${fmtMs(s.genMedianMs)} | ±${fmtMs(s.genStddevMs)} | ${Math.round(s.charMedian)} | ${s.okRuns}/${N_ROUNDS} |`
).join('\n');

const wikiContent = `---
title: Phase 4 — context.route resource blocking ${TODAY}
type: analysis
tags: [benchmark, gbrain-companion, perf, source:ai, phase:4, super-engine]
source: ai
date: ${TODAY}
ai_confidence: high
---

# Phase 4 — context.route 資源攔截（blockResources:true）

**基礎：Phase 2+3（expanded args + stabilityIntervalMs ${STABILITY_MS}ms）**
**變因：super-engine fork 加入 Playwright route 攔截，封鎖 image/media/font 請求**

## 判定

init_ms: ${fmtMs(initMs)} vs P2 ~${fmtMs(PHASE2_INIT_MS)} → **${pctDiff(initMs, PHASE2_INIT_MS)}**
gen_ms: ${fmtMs(overallGenMedian)} vs P3 ~${fmtMs(PHASE3_GEN_MEDIAN_MS)} → **${pctDiff(overallGenMedian, PHASE3_GEN_MEDIAN_MS)}**

${initDeltaPct <= 0 ? '✅ **採用** — init 有改善' : '❌ **調查** — init 反而更慢，需要 debug 被擋的請求'}

## 環境

| 項目 | 值 |
|---|---|
| 日期 | ${TODAY} |
| Rounds | ${N_ROUNDS} |
| blockResources | true |
| 攔截類型 | image, media, font (recaptcha 豁免) |
| stabilityIntervalMs | ${STABILITY_MS}ms |
| weblm-driver | local fork (super-engine) |

## Phase 對比

| Phase | init_ms | gen median |
|---|---|---|
| P0 baseline | 19.7s | 24.4s |
| P1 newConv:false | 18.2s | 10.4s |
| P2 extra args | ~${fmtMs(PHASE2_INIT_MS)} | ~${fmtMs(PHASE3_GEN_MEDIAN_MS)} |
| **P4 blockResources** | **${fmtMs(initMs)}** | **${fmtMs(overallGenMedian)}** |

## 結果

| Slug | Prompt | Gen median | ±stddev | Chars | OK |
|---|---|---|---|---|---|
${tableRows}
| **Overall** | — | **${fmtMs(overallGenMedian)}** | — | — | — |

## super-engine 改動

\`\`\`typescript
// BrowserSession.ts — after launchPersistentContext()
if (this.config.blockResources) {
  await this._context.route('**/*', (route) => {
    const req = route.request();
    const type = req.resourceType();
    const url = req.url().toLowerCase();
    if (url.includes('recaptcha') || url.includes('gstatic.com/recaptcha')) {
      return route.continue();
    }
    if (['image', 'media', 'font'].includes(type)) {
      return route.abort();
    }
    return route.continue();
  });
}
\`\`\`

## 原始 JSON

\`\`\`json
${JSON.stringify(jsonResult, null, 2)}
\`\`\`
`;

try { await putPage(WIKI_SLUG, wikiContent); console.log(`Wiki: ${WIKI_SLUG}`); }
catch (e) { console.warn(`Wiki write failed: ${e}`); }
console.log('\nDone.');

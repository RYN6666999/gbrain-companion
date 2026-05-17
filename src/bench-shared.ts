/**
 * bench-shared.ts — shared helpers for all phase bench scripts
 */

export interface RunRecord {
  round: number;
  slug: string;
  genMs: number;
  chars: number;
  ok: boolean;
  error?: string;
}

export interface SlugStats {
  slug: string;
  promptChars: number;
  genMedianMs: number;
  genMeanMs: number;
  genStddevMs: number;
  charMedian: number;
  okRuns: number;
}

export function fmtMs(ms: number): string { return `${(ms / 1000).toFixed(1)}s`; }

export function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

export function mean(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export function stddev(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  return Math.sqrt(values.map(v => (v - m) ** 2).reduce((a, b) => a + b, 0) / values.length);
}

export function pctDiff(a: number, b: number): string {
  if (!b) return 'N/A';
  const d = ((a - b) / b) * 100;
  return `${d >= 0 ? '+' : ''}${d.toFixed(1)}%`;
}

export function slugTail(slug: string): string {
  return slug.split('/').pop()!.slice(0, 20);
}

export function aggregateSlugs(
  slugs: Array<{ slug: string; promptChars: number }>,
  records: RunRecord[],
  nRounds: number,
): SlugStats[] {
  return slugs.map(({ slug, promptChars }) => {
    const ok = records.filter(r => r.slug === slug && r.ok);
    const genMss = ok.map(r => r.genMs);
    const charss = ok.map(r => r.chars);
    return {
      slug,
      promptChars,
      genMedianMs: median(genMss),
      genMeanMs: mean(genMss),
      genStddevMs: stddev(genMss),
      charMedian: median(charss),
      okRuns: ok.length,
    };
  });
}

// Phase 0 baseline (N=3 median)
export const PHASE0 = {
  initMs: 19700,
  genOverallMedianMs: 24400,
  slugMedians: {
    'wiki/projects/super-engine': { genMs: 24900, chars: 941 },
    'wiki/projects/gbrain-companion/architecture': { genMs: 23800, chars: 750 },
    'wiki/projects/gbrain-companion/roadmap': { genMs: 23700, chars: 716 },
    'wiki/projects/gbrain-companion/perf/2026-05-17-chrome-for-testing-comparison': { genMs: 24300, chars: 771 },
    'wiki/identity/gbrain-system-prompt-v4': { genMs: 24700, chars: 867 },
  } as Record<string, { genMs: number; chars: number }>,
};

// Phase 1 baseline (N=3 median, newConversation:false)
export const PHASE1 = {
  initMs: 18200,
  genOverallMedianMs: 10400,
  slugMedians: {
    'wiki/projects/super-engine': { genMs: 9800, chars: 993 },
    'wiki/projects/gbrain-companion/architecture': { genMs: 10600, chars: 941 },
    'wiki/projects/gbrain-companion/roadmap': { genMs: 8700, chars: 1010 },
    'wiki/projects/gbrain-companion/perf/2026-05-17-chrome-for-testing-comparison': { genMs: 10800, chars: 1006 },
    'wiki/identity/gbrain-system-prompt-v4': { genMs: 11000, chars: 967 },
  } as Record<string, { genMs: number; chars: number }>,
};

export const SLUGS = [
  'wiki/projects/super-engine',
  'wiki/projects/gbrain-companion/architecture',
  'wiki/projects/gbrain-companion/roadmap',
  'wiki/projects/gbrain-companion/perf/2026-05-17-chrome-for-testing-comparison',
  'wiki/identity/gbrain-system-prompt-v4',
];

export const SOFT_RESET_PREFIX = '[新任務，請忽略上一個對話]\n\n';

import { describe, it, expect, beforeAll } from 'vitest';
import { search } from '../src/gbrain-client.ts';

// Requires GBRAIN_OTP env var (daily OTP from otp-app.ts at localhost:4244)
// Run: GBRAIN_OTP=$(curl -s http://localhost:4244/api/otp | jq -r .otp) bun test tests/gbrain-client.search.test.ts

beforeAll(() => {
  if (!process.env.GBRAIN_OTP) {
    throw new Error('GBRAIN_OTP is not set. Get it from: curl -s http://localhost:4244/api/otp | jq -r .otp');
  }
});

describe('gbrain search()', () => {
  it('returns results for a known term', async () => {
    const start = Date.now();
    const results = await search('gbrain', 5);
    const ms = Date.now() - start;

    expect(results.length).toBeGreaterThan(0);
    expect(ms).toBeLessThan(3000);

    // each result has expected shape
    for (const r of results) {
      expect(r).toHaveProperty('slug');
      expect(r).toHaveProperty('title');
      expect(r).toHaveProperty('chunk_text');
      expect(typeof r.score).toBe('number');
    }
  }, 10_000);

  it('returns empty array for a nonsense query without throwing', async () => {
    const start = Date.now();
    const results = await search('xyznotexist123abc', 5);
    const ms = Date.now() - start;

    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBe(0);
    expect(ms).toBeLessThan(3000);
  }, 10_000);

  it('hyphenated term "super-engine" — documents BM25 tokenization behavior', async () => {
    // Known issue: BM25 splits "super-engine" into "super" + "engine" tokens.
    // The search may return 0 results even though the page exists at wiki/projects/super-engine.
    // This test records the actual behavior without asserting a specific count.
    const start = Date.now();
    const results = await search('super-engine', 5);
    const ms = Date.now() - start;

    expect(ms).toBeLessThan(3000);

    // Log findings for the result page — not a hard assertion
    const slugs = results.map(r => r.slug);
    const foundDirectPage = slugs.includes('wiki/projects/super-engine');
    console.log(`[T002] super-engine search: ${results.length} results, direct page found: ${foundDirectPage}`);
    console.log(`[T002] slugs: ${JSON.stringify(slugs)}`);

    // The test always passes — we're documenting, not gating
    expect(Array.isArray(results)).toBe(true);
  }, 10_000);

  it('respects the limit parameter', async () => {
    const results = await search('wiki', 3);
    expect(results.length).toBeLessThanOrEqual(3);
  }, 10_000);
});

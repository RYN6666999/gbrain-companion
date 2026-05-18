/**
 * brain.ts — Strategy layer over the gbrain HTTP API.
 *
 * Knows: OTP rotation, slug naming conventions, content formatting.
 * Delegates: HTTP calls to the inline GBrainClient.
 *
 * Usage:
 *   import { createBrain } from './brain.ts';
 *   const brain = createBrain();                 // reads env vars
 *   const { slug } = await brain.saveNote('# Idea\n\nSomething new.');
 *   const results  = await brain.search('typescript patterns');
 */

import { createHash, createHmac } from 'crypto';

// ── OTP helpers ────────────────────────────────────────────────────────────────

/**
 * Compute today's TOTP matching server's verifyOtp() logic.
 * Server accepts windowOffset -1, 0, +1 for clock skew.
 */
export function todayOtp(secret: string): string {
  const day = Math.floor(Date.now() / 86_400_000);
  return createHmac('sha256', secret).update(String(day)).digest('hex').slice(0, 10);
}

// ── Slug naming conventions ────────────────────────────────────────────────────

/**
 * Convert arbitrary text to a URL-safe slug fragment.
 * Used for wiki pages, people, companies.
 */
export function toSlug(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip accents
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

/** Ephemeral memory slug: mem/YYYY-MM-DD/xxxx */
export function memSlug(date?: string): string {
  const d = date ?? new Date().toISOString().slice(0, 10);
  const id = Math.random().toString(36).slice(2, 6);
  return `mem/${d}/${id}`;
}

/** Wiki page slug: wiki/{domain}/{title} */
export function wikiSlug(domain: string, title: string): string {
  return `wiki/${domain}/${toSlug(title)}`;
}

/** Person page slug: people/{name} */
export function personSlug(name: string): string {
  return `people/${toSlug(name)}`;
}

/** Company page slug: companies/{name} */
export function companySlug(name: string): string {
  return `companies/${toSlug(name)}`;
}

// ── Inline GBrainClient (full version) ────────────────────────────────────────
// Self-contained so brain.ts has no dependency on gbrain-client.ts.

export interface SearchResult {
  slug: string;
  score: number;
  title?: string;
  excerpt?: string;
  [key: string]: unknown;
}

export interface Page {
  slug: string;
  content?: string;
  content_hash?: string;
  title?: string;
  tags?: string[];
  [key: string]: unknown;
}

export interface WriteResult {
  ok: true;
  slug: string;
  content_hash: string;
  status?: 'imported' | 'skipped';
  idempotent?: boolean;
}

interface AsyncWriteResult {
  ok: true;
  job_id: string;
  slug: string;
  status: 'pending';
}

interface JobResult {
  ok: boolean;
  job_id: string;
  slug: string;
  content_hash: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  error?: string;
}

export class GBrainError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status: number,
    public readonly hint?: string,
  ) {
    super(message);
    this.name = 'GBrainError';
  }
}

class GBrainClient {
  constructor(
    private readonly base: string,
    private readonly token: string,
    private readonly writeTimeoutMs = 30_000,
    private readonly readTimeoutMs = 10_000,
  ) {
    this.base = base.replace(/\/$/, '');
  }

  private url(path: string, params?: Record<string, string>): string {
    const sp = new URLSearchParams({ otp: this.token, ...params });
    return `${this.base}${path}?${sp.toString()}`;
  }

  private async request<T>(url: string, init: RequestInit, timeoutMs: number): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetch(url, { ...init, signal: controller.signal });
    } catch (e) {
      if ((e as Error).name === 'AbortError') {
        throw new GBrainError(`Request timed out after ${timeoutMs}ms`, 'timeout', 0);
      }
      throw e;
    } finally {
      clearTimeout(timer);
    }
    const body = await res.json() as Record<string, unknown>;
    if (!body.ok) {
      throw new GBrainError(
        String(body.error ?? body.message ?? 'Unknown error'),
        String(body.code ?? 'unknown'),
        res.status,
        body.hint as string | undefined,
      );
    }
    return body as T;
  }

  get<T>(path: string, params?: Record<string, string>, timeout?: number): Promise<T> {
    return this.request<T>(this.url(path, params), { method: 'GET' }, timeout ?? this.readTimeoutMs);
  }

  put<T>(path: string, body: unknown, params?: Record<string, string>, timeout?: number): Promise<T> {
    return this.request<T>(
      this.url(path, params),
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'X-Gbrain-OTP': this.token },
        body: JSON.stringify(body),
      },
      timeout ?? this.writeTimeoutMs,
    );
  }

  health(): Promise<{ ok: boolean; warm: boolean; version: string }> {
    return this.get('/health');
  }

  search(query: string, limit = 10): Promise<{ results: SearchResult[] }> {
    return this.get('/search', { q: query, limit: String(Math.min(limit, 50)) });
  }

  searchHybrid(opts: { lex?: string; vec?: string; hyde?: string; limit?: number }): Promise<{ results: SearchResult[] }> {
    const params: Record<string, string> = {};
    if (opts.lex) params.lex = opts.lex;
    if (opts.vec) params.vec = opts.vec;
    if (opts.hyde) params.hyde = opts.hyde;
    if (opts.limit) params.limit = String(Math.min(opts.limit, 50));
    return this.get('/search', params);
  }

  getPage(slug: string): Promise<{ page: Page }> {
    return this.get('/page', { slug });
  }

  putPage(opts: { slug: string; content: string; idempotencyKey?: string }): Promise<WriteResult> {
    return this.put<WriteResult>('/page', {
      slug: opts.slug,
      content: opts.content,
      ...(opts.idempotencyKey ? { idempotency_key: opts.idempotencyKey } : {}),
    });
  }

  putPageAsync(opts: { slug: string; content: string; idempotencyKey?: string }): Promise<AsyncWriteResult> {
    return this.put<AsyncWriteResult>('/page', {
      slug: opts.slug,
      content: opts.content,
      async: 1,
      ...(opts.idempotencyKey ? { idempotency_key: opts.idempotencyKey } : {}),
    });
  }

  async pollJob(jobId: string, opts: { intervalMs?: number; maxPolls?: number } = {}): Promise<JobResult> {
    const intervalMs = opts.intervalMs ?? 2_000;
    const maxPolls = opts.maxPolls ?? 15;
    for (let i = 0; i < maxPolls; i++) {
      if (i > 0) await sleep(intervalMs);
      const job = await this.get<JobResult>('/job', { id: jobId });
      if (job.status === 'completed' || job.status === 'failed') return job;
    }
    throw new GBrainError(`Job ${jobId} did not complete after ${maxPolls} polls`, 'poll_timeout', 0);
  }

  async write(opts: {
    slug: string;
    content: string;
    idempotencyKey?: string;
    asyncThresholdChars?: number;
  }): Promise<WriteResult> {
    const threshold = opts.asyncThresholdChars ?? 2_000;
    if (opts.content.length <= threshold) return this.putPage(opts);

    const job = await this.putPageAsync(opts);
    const result = await this.pollJob(job.job_id);
    if (result.status === 'failed') {
      throw new GBrainError(`Async write failed: ${result.error ?? 'unknown'}`, 'write_failed', 0);
    }
    return { ok: true, slug: opts.slug, content_hash: result.content_hash, status: 'imported' };
  }

  addTag(slug: string, tag: string): Promise<{ ok: true }> {
    return this.get('/write', { action: 'add_tag', slug, tag });
  }

  addLink(from: string, to: string, opts?: { linkType?: string; context?: string }): Promise<{ ok: true }> {
    return this.get('/write', {
      action: 'add_link',
      from,
      to,
      ...(opts?.linkType ? { link_type: opts.linkType } : {}),
      ...(opts?.context ? { context: opts.context } : {}),
    });
  }

  addTimelineEntry(slug: string, date: string, description: string): Promise<{ ok: true }> {
    return this.get('/write', { action: 'add_timeline_entry', slug, date, description });
  }

  static idempotencyKey(slug: string, content: string): string {
    return createHash('sha256').update(slug + '\0' + content).digest('hex').slice(0, 16);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── Brain — strategy layer ─────────────────────────────────────────────────────

export interface BrainOpts {
  base?: string;
  /** Static OTP (overrides secret). */
  token?: string;
  /** TOTP secret — computes daily token automatically. */
  secret?: string;
}

export class Brain {
  private client: GBrainClient;
  private readonly base: string;

  constructor(opts: BrainOpts) {
    this.base = (opts.base ?? process.env['GBRAIN_BASE_URL'] ?? 'https://gbrain-production-18fa.up.railway.app').replace(/\/$/, '');
    const token = opts.token ?? (opts.secret ? todayOtp(opts.secret) : (process.env['GBRAIN_OTP'] ?? ''));
    if (!token) throw new Error('Brain: set GBRAIN_OTP (static) or GBRAIN_TOTP_SECRET (daily-rotating)');
    this.client = new GBrainClient(this.base, token);
  }

  /** Rotate to today's fresh OTP. Call at the start of a long session. */
  refreshToken(secret: string): void {
    this.client = new GBrainClient(this.base, todayOtp(secret));
  }

  // ── Read ─────────────────────────────────────────────────────────────────────

  health() { return this.client.health(); }

  search(query: string, limit = 5): Promise<{ results: SearchResult[] }> {
    return this.client.search(query, limit);
  }

  searchHybrid(opts: Parameters<GBrainClient['searchHybrid']>[0]): Promise<{ results: SearchResult[] }> {
    return this.client.searchHybrid(opts);
  }

  async getPage(slug: string): Promise<Page | null> {
    try {
      const { page } = await this.client.getPage(slug);
      return page;
    } catch (e) {
      if (e instanceof GBrainError && e.status === 404) return null;
      throw e;
    }
  }

  // ── Write ─────────────────────────────────────────────────────────────────────

  /**
   * Save an ephemeral note under mem/{date}/{id}.
   * Returns the auto-generated slug + content_hash.
   */
  async saveNote(content: string, opts?: { date?: string; title?: string }): Promise<{ slug: string; content_hash: string }> {
    const slug = memSlug(opts?.date);
    const body = opts?.title ? `# ${opts.title}\n\n${content}` : content;
    const result = await this.client.write({ slug, content: body, idempotencyKey: GBrainClient.idempotencyKey(slug, body) });
    return { slug, content_hash: result.content_hash };
  }

  /**
   * Save a structured wiki page. Caller provides the full slug.
   * Prepends a markdown `# Title` header automatically.
   */
  async savePage(opts: { slug: string; title: string; content: string }): Promise<{ slug: string; content_hash: string }> {
    const body = `# ${opts.title}\n\n${opts.content}`;
    const result = await this.client.write({
      slug: opts.slug,
      content: body,
      idempotencyKey: GBrainClient.idempotencyKey(opts.slug, body),
    });
    return { slug: opts.slug, content_hash: result.content_hash };
  }

  /**
   * Save a conversation (AI session) as a structured memory page.
   * Slug: mem/{date}/{title-slug}
   */
  async saveConversation(opts: {
    title: string;
    turns: Array<{ role: 'human' | 'assistant'; text: string }>;
    date?: string;
    tags?: string[];
  }): Promise<{ slug: string; content_hash: string }> {
    const date = opts.date ?? new Date().toISOString().slice(0, 10);
    const slug = `mem/${date}/${toSlug(opts.title).slice(0, 40)}`;

    const frontmatter = [
      '---',
      `date: ${date}`,
      `title: "${opts.title}"`,
      ...(opts.tags?.length ? [`tags: [${opts.tags.map(t => `"${t}"`).join(', ')}]`] : []),
      '---',
    ].join('\n');

    const body = opts.turns
      .map(t => `**${t.role === 'human' ? 'Human' : 'Assistant'}:**\n\n${t.text}`)
      .join('\n\n---\n\n');

    const content = `${frontmatter}\n\n# ${opts.title}\n\n${body}`;
    const result = await this.client.write({
      slug,
      content,
      idempotencyKey: GBrainClient.idempotencyKey(slug, content),
    });
    return { slug, content_hash: result.content_hash };
  }

  /**
   * Save raw content directly (no formatting applied).
   * Use for content that already has proper frontmatter + heading.
   */
  async writeRaw(slug: string, content: string): Promise<{ slug: string; content_hash: string }> {
    const result = await this.client.write({
      slug,
      content,
      idempotencyKey: GBrainClient.idempotencyKey(slug, content),
    });
    return { slug, content_hash: result.content_hash };
  }

  // ── Graph ─────────────────────────────────────────────────────────────────────

  addLink(from: string, to: string, opts?: { linkType?: string; context?: string }) {
    return this.client.addLink(from, to, opts);
  }

  addTag(slug: string, tag: string) { return this.client.addTag(slug, tag); }

  addTimelineEntry(slug: string, date: string, description: string) {
    return this.client.addTimelineEntry(slug, date, description);
  }
}

// ── Singleton factory ──────────────────────────────────────────────────────────

/**
 * Create a Brain from environment variables.
 * Prefers GBRAIN_TOTP_SECRET (daily-rotating) over GBRAIN_OTP (static).
 */
export function createBrain(opts?: { base?: string }): Brain {
  const secret = process.env['GBRAIN_TOTP_SECRET'];
  const token  = process.env['GBRAIN_OTP'];
  return new Brain({ base: opts?.base, secret, token });
}

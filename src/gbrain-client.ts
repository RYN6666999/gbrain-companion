const BASE_URL = process.env.GBRAIN_BASE_URL ?? 'https://gbrain-production-18fa.up.railway.app';

function otp(): string {
  const key = process.env.GBRAIN_OTP ?? '';
  if (!key) throw new Error('GBRAIN_OTP is not set');
  return key;
}

function authHeaders(): Record<string, string> {
  return { Authorization: `OTP ${otp()}`, 'Content-Type': 'application/json' };
}

function withOtp(endpoint: string): string {
  const sep = endpoint.includes('?') ? '&' : '?';
  return `${BASE_URL}${endpoint}${sep}otp=${otp()}`;
}

export interface SearchResult {
  slug: string;
  title: string;
  chunk_text: string;
  score: number;
}

export async function search(query: string, limit = 10): Promise<SearchResult[]> {
  const url = withOtp(`/search?q=${encodeURIComponent(query)}&limit=${limit}`);
  const res = await fetch(url);
  const data = await res.json() as { ok: boolean; results?: SearchResult[] };
  if (!data.ok) throw new Error(`search failed: ${JSON.stringify(data)}`);
  return data.results ?? [];
}

export interface Page {
  slug: string;
  title: string;
  compiled_truth: string;
  type: string;
}

export async function getPage(slug: string): Promise<Page | null> {
  const url = withOtp(`/page?slug=${encodeURIComponent(slug)}`);
  const res = await fetch(url);
  if (res.status === 404) return null;
  const data = await res.json() as { ok: boolean; page?: Page };
  if (!data.ok) throw new Error(`getPage failed: ${JSON.stringify(data)}`);
  return data.page ?? null;
}

export async function putPage(slug: string, content: string): Promise<void> {
  const res = await fetch(`${BASE_URL}/page`, {
    method: 'PUT',
    headers: authHeaders(),
    body: JSON.stringify({ slug, content }),
  });
  const data = await res.json() as { ok: boolean };
  if (!data.ok) throw new Error(`putPage failed: ${JSON.stringify(data)}`);
}

export async function addLink(from: string, to: string, linkType = 'mentions', context?: string): Promise<void> {
  const params = new URLSearchParams({ action: 'add_link', from, to, link_type: linkType, otp: otp() });
  if (context) params.set('context', context);
  const url = `${BASE_URL}/write?${params}`;
  const res = await fetch(url);
  const data = await res.json() as { ok: boolean };
  if (!data.ok) throw new Error(`addLink failed: ${JSON.stringify(data)}`);
}

import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api } from './api';

afterEach(() => vi.restoreAllMocks());

describe('API client', () => {
  it('sends credentials and the mutation security header for writes', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ data: { ok: true } }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    await expect(api<{ data: { ok: boolean } }>('/test', { method: 'POST', body: { title: 'job' } })).resolves.toEqual({ data: { ok: true } });
    const [, options] = fetchSpy.mock.calls[0]!;
    expect(options?.credentials).toBe('include');
    expect((options?.headers as Record<string, string>)['X-Requested-With']).toBe('XMLHttpRequest');
  });
  it('turns API error envelopes into ApiError', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ error: { code: 'BAD_INPUT', message: 'Check the title.' } }), { status: 422, headers: { 'Content-Type': 'application/json' } }));
    await expect(api('/test')).rejects.toMatchObject({ name: 'ApiError', status: 422, code: 'BAD_INPUT', message: 'Check the title.' });
  });
  it('returns undefined for no-content responses', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 204 }));
    await expect(api('/test', { method: 'DELETE' })).resolves.toBeUndefined();
  });
});

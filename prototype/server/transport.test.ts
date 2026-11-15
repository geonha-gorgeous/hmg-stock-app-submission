import { expect, it, vi } from 'vitest';
import { createTransport } from './transport.ts';

it('does not retry a write when the network fails', async () => {
  const fetcher = vi.fn().mockRejectedValue(new Error('secret upstream details'));
  const transport = createTransport('https://mockapi.kiwoom.com', { fetch: fetcher, intervalMs: 0 });
  await expect(transport('/api/dostk/ordr', { method: 'POST', body: { test: true } })).rejects.toMatchObject({ code: 'NETWORK' });
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it('prevents escaping the fixed provider host and rejects malformed responses', async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response('[]'));
  const transport = createTransport('https://mockapi.kiwoom.com', { fetch: fetcher, intervalMs: 0 });
  await expect(transport('//attacker.example')).rejects.toMatchObject({ code: 'INVALID_PATH' });
  expect(fetcher).not.toHaveBeenCalled();
  await expect(transport('/api/dostk/ordr')).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
});
it('spaces requests even when called concurrently', async () => {
  const calls: number[] = [];
  const fetcher = vi.fn(async () => { calls.push(Date.now()); return new Response('{}'); });
  const transport = createTransport('https://mockapi.kiwoom.com', { fetch: fetcher, intervalMs: 30 });
  await Promise.all([transport('/a'), transport('/b'), transport('/c')]);
  expect(calls[1] - calls[0]).toBeGreaterThanOrEqual(27);
  expect(calls[2] - calls[1]).toBeGreaterThanOrEqual(27);
});

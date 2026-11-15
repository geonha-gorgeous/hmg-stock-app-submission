import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppOrder, Quote } from '../shared/broker';
import { blank, BrokerError, failed, quoteSummary, received, reconcileOrders, request } from './brokerClient';

const order: AppOrder = { id: 'intent-1', symbol: '005930', side: 'buy', quantity: 2, price: 70000, status: 'unknown', filledQuantity: 0, remainingQuantity: 2, submittedAt: '2026-11-02T01:00:00Z' };
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
describe('broker view state', () => {
  it('keeps unknown cash and missing snapshots distinct from a zero balance', () => {
    expect(blank().value).toBeNull();
    expect(received({ availableCash: null, positions: [] }).value?.availableCash).toBeNull();
    expect(received({ availableCash: 0, positions: [] }).value?.availableCash).toBe(0);
  });
  it('retains the last successful snapshot and its time when refresh fails', () => {
    const previous = received({ availableCash: 12000 });
    const next = failed(previous, new Error('조회 실패'));
    expect(next.value).toBe(previous.value);
    expect(next.receivedAt).toBe(previous.receivedAt);
    expect(next.error).toBe('조회 실패');
  });
  it('keeps an unresolved intent visible and replaces it when reconciled', () => {
    expect(reconcileOrders([], [order])).toEqual([order]);
    const resolved = { ...order, status: 'partially_filled' as const, filledQuantity: 1, remainingQuantity: 1 };
    expect(reconcileOrders([resolved], [order])).toEqual([resolved]);
  });
  it('speaks the returned quote and does not invent a missing quote', () => {
    const quote: Quote = { symbol: '005930', name: '삼성전자', price: 71200, change: -100, percent: -0.14, asOf: '2026-11-02T01:00:00Z' };
    expect(quoteSummary(quote)).toContain('71,200원');
    expect(quoteSummary(quote)).toContain('-0.14퍼센트');
    expect(quoteSummary()).toBe('조회한 시세가 없습니다.');
  });
});
describe('broker transport', () => {
  it('serializes requests, carries the session only on mutations, and marks lost submission responses ambiguous', async () => {
    const starts: number[] = [];
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    const fetchMock = vi.fn(async (_url: unknown, init?: RequestInit) => {
      starts.push(Date.now());
      if (init?.method === 'POST') throw new TypeError('connection lost');
      return new Response(JSON.stringify({ configured: true }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const results = await Promise.allSettled([request('/status'), request('/orders', 'session-1', { intentId: 'intent-1' }), request('/quotes?symbols=005930,000660,005380,035420')]);
    expect(results[0].status).toBe('fulfilled');
    expect(results[1].status).toBe('rejected');
    if (results[1].status === 'rejected') {
      expect(results[1].reason).toBeInstanceOf(BrokerError);
      expect(results[1].reason.ambiguous).toBe(true);
    }
    expect(starts[1] - starts[0]).toBeGreaterThanOrEqual(1000);
    expect(timeout.mock.calls.map(call => call[0])).toEqual([45000, 45000, 90000]);
    expect(fetchMock.mock.calls[0][1]?.headers).toBeUndefined();
    expect(fetchMock.mock.calls[1][1]?.headers).toEqual({ 'Content-Type': 'application/json', 'X-Donda-Session': 'session-1' });
  });
});

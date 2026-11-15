import type { AppOrder, Quote } from '../shared/broker';

export class BrokerError extends Error {
  constructor(message: string, public code: string, public ambiguous = false) { super(message); }
}
// One queue serves refreshes, buying-power queries and mutations. Broker calls do not overlap.
let queue: Promise<unknown> = Promise.resolve();
let lastRequest = 0;
export function request<T>(path: string, session?: string, body?: unknown): Promise<T> {
  const run = async () => {
    await new Promise(resolve => setTimeout(resolve, Math.max(0, 1050 - (Date.now() - lastRequest))));
    lastRequest = Date.now();
    let response: Response;
    try {
      response = await fetch(`/api${path}`, { method: body === undefined ? 'GET' : 'POST',
        headers: body === undefined ? undefined : { 'Content-Type': 'application/json', 'X-Donda-Session': session ?? '' },
        body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(path.startsWith('/quotes') ? 90000 : 45000) });
    } catch { throw new BrokerError('서버 응답을 확인하지 못했습니다.', 'NETWORK', body !== undefined); }
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new BrokerError(data?.error?.message ?? '요청을 처리하지 못했습니다.', data?.error?.code ?? 'HTTP', body !== undefined && response.status >= 500);
    if (!data) throw new BrokerError('서버 응답 형식을 확인할 수 없습니다.', 'RESPONSE', body !== undefined);
    return data as T;
  };
  const next = queue.then(run, run);
  queue = next.catch(() => undefined);
  return next;
}
export interface Snapshot<T> { value: T | null; error: string | null; receivedAt: number | null }
export const blank = <T>(): Snapshot<T> => ({ value: null, error: null, receivedAt: null });
export const received = <T>(value: T): Snapshot<T> => ({ value, error: null, receivedAt: Date.now() });
export const failed = <T>(previous: Snapshot<T>, error: unknown): Snapshot<T> => ({ ...previous, error: error instanceof Error ? error.message : '조회하지 못했습니다.' });
export function reconcileOrders(remote: AppOrder[], previous: AppOrder[]): AppOrder[] {
  // A lost submission response remains visible until the server resolves that same intent.
  const known = new Set(remote.map(order => order.id));
  return [...remote, ...previous.filter(order => order.status === 'unknown' && !known.has(order.id))];
}
export function quoteSummary(quote?: Quote): string {
  return quote ? `${quote.name} ${quote.price.toLocaleString('ko-KR')}원, 전일 대비 ${quote.percent > 0 ? '+' : ''}${quote.percent.toFixed(2)}퍼센트입니다.` : '조회한 시세가 없습니다.';
}

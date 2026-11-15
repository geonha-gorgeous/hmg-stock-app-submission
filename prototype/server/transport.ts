import { BrokerError } from './contracts.ts';
import type { Transport, TransportResponse } from './contracts.ts';

/** One queue per broker avoids overlapping paper requests; writes are never retried. */
export function createTransport(baseUrl: string, options: { fetch?: typeof fetch; intervalMs?: number; timeoutMs?: number } = {}): Transport {
  const request = options.fetch || fetch;
  const interval = options.intervalMs ?? 1100;
  const timeout = options.timeoutMs ?? 15000;
  let chain: Promise<unknown> = Promise.resolve();
  let lastStart = 0;
  return (path, init = {}) => {
    const run = async (): Promise<TransportResponse> => {
      if (!path.startsWith('/') || path.startsWith('//')) throw new BrokerError('INVALID_PATH', 'API 경로를 확인해 주세요.');
      const url = new URL(path, baseUrl);
      if (url.origin !== new URL(baseUrl).origin) throw new BrokerError('INVALID_PATH', 'API 경로를 확인해 주세요.');
      for (const [key, value] of Object.entries(init.query || {})) url.searchParams.set(key, value);
      const delay = lastStart + interval - Date.now();
      if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay));
      lastStart = Date.now();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);
      try {
        const response = await request(url, { method: init.method || 'GET', headers: { 'content-type': 'application/json; charset=utf-8', ...init.headers }, body: init.body === undefined ? undefined : JSON.stringify(init.body), signal: controller.signal, redirect: 'error' });
        if (!response.ok) throw new BrokerError('UPSTREAM_HTTP', `증권사 응답 오류(${response.status})입니다. 주문내역을 확인해 주세요.`);
        const data: unknown = await response.json();
        if (!data || typeof data !== 'object' || Array.isArray(data)) throw new BrokerError('INVALID_RESPONSE', '증권사 응답 형식을 확인할 수 없습니다.');
        return { data: data as Record<string, unknown>, headers: response.headers };
      } catch (error) {
        if (error instanceof BrokerError) throw error;
        throw new BrokerError(controller.signal.aborted ? 'TIMEOUT' : 'NETWORK', '증권사 응답을 확인하지 못했습니다. 주문내역을 조회해 주세요.');
      } finally { clearTimeout(timer); }
    };
    const result = chain.then(run);
    chain = result.catch(() => undefined);
    return result;
  };
}

import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { BrokerError } from './contracts.ts';
import type { ServerConfig } from './config.ts';
import type { BrokerService } from './service.ts';

function json(response: ServerResponse, status: number, data: unknown) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  response.end(JSON.stringify(data));
}

async function body(request: IncomingMessage) {
  if (!request.headers['content-type']?.startsWith('application/json')) throw new BrokerError('INVALID_INPUT', 'JSON 요청이 필요합니다.');
  let data = '';
  for await (const chunk of request) {
    data += chunk.toString();
    if (Buffer.byteLength(data) > 8192) throw new BrokerError('INVALID_INPUT', '요청 크기가 너무 큽니다.');
  }
  try { return JSON.parse(data); } catch { throw new BrokerError('INVALID_INPUT', '요청 형식이 올바르지 않습니다.'); }
}

/** Local single-account server. Host/origin checks and write tokens guard browser requests. */
export function createApiServer(config: ServerConfig, service?: BrokerService) {
  const session = randomBytes(32).toString('hex');
  return createServer(async (request, response) => {
    try {
      const host = request.headers.host || '';
      if (!/^(127\.0\.0\.1|localhost):\d+$/.test(host)) throw new BrokerError('FORBIDDEN', '허용되지 않은 호스트입니다.');
      const origin = request.headers.origin;
      if ((origin && ![...config.allowedOrigins, `http://${host}`].includes(origin)) || request.headers['sec-fetch-site'] === 'cross-site') throw new BrokerError('FORBIDDEN', '허용되지 않은 출처입니다.');
      if (request.method === 'POST') {
        const value = request.headers['x-donda-session'];
        if (typeof value !== 'string' || value.length !== session.length || !timingSafeEqual(Buffer.from(value), Buffer.from(session))) throw new BrokerError('FORBIDDEN', '연결 상태를 새로고침한 뒤 다시 시도해 주세요.');
      }
      const url = new URL(request.url || '/', 'http://127.0.0.1');
      if (request.method === 'GET' && url.pathname === '/api/status') return json(response, 200, { provider: config.provider, environment: 'paper', configured: config.missing.length === 0, missing: config.missing, session });
      if (!service || config.missing.length) throw new BrokerError('NOT_CONFIGURED', config.provider === 'demo' ? '예시 데이터 모드입니다.' : '서버의 증권사 API 설정을 완료해 주세요.');
      const symbol = url.searchParams.get('symbol') || '';
      if (request.method === 'GET' && url.pathname === '/api/quotes') {
        const symbols = [...new Set((url.searchParams.get('symbols') || '').split(','))];
        if (symbols.length > 4 || symbols.some(value => !/^\d{6}$/.test(value))) throw new BrokerError('INVALID_INPUT', '최대 4개 종목을 조회할 수 있습니다.');
        const quotes = [];
        for (const item of symbols) quotes.push(await service.adapter.getQuote(item));
        return json(response, 200, { quotes });
      }
      if (request.method === 'GET' && url.pathname === '/api/account') return json(response, 200, { account: await service.adapter.getAccount() });
      if (request.method === 'GET' && url.pathname === '/api/buying-power') {
        const price = Number(url.searchParams.get('price'));
        if (!/^\d{6}$/.test(symbol) || !Number.isSafeInteger(price) || price <= 0) throw new BrokerError('INVALID_INPUT', '종목과 가격을 확인해 주세요.');
        return json(response, 200, { availableCash: await service.adapter.getBuyingPower(symbol, price) });
      }
      if (url.pathname === '/api/orders' && request.method === 'GET') return json(response, 200, { orders: await service.list() });
      if (url.pathname === '/api/orders' && request.method === 'POST') return json(response, 200, { order: await service.place(await body(request)) });
      const cancel = url.pathname.match(/^\/api\/orders\/([^/]+)\/cancel$/);
      if (cancel && request.method === 'POST') {
        await body(request);
        return json(response, 200, { order: await service.cancel(decodeURIComponent(cancel[1])) });
      }
      json(response, 404, { error: { code: 'NOT_FOUND', message: '요청한 API를 찾을 수 없습니다.' } });
    } catch (error) {
      const known = error instanceof BrokerError;
      const code = known ? error.code : 'INTERNAL';
      const status = ({ INVALID_INPUT: 400, FORBIDDEN: 403, NOT_FOUND: 404, CONFLICT: 409, NOT_CONFIGURED: 503 } as Record<string, number>)[code] || 502;
      json(response, status, { error: { code, message: known ? error.message : '서버 처리 결과를 확인하지 못했습니다. 연결 상태와 주문내역을 확인해 주세요.' } });
    }
  });
}

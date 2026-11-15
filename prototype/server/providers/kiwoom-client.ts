import { BrokerError, type BrokerCredentials, type Transport, type TransportResponse } from '../contracts.ts';

export function requiredText(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new BrokerError('INVALID_RESPONSE', `${label} 응답을 확인할 수 없습니다.`);
  return value.trim();
}
export function amount(value: unknown, label: string): number {
  if (!['string', 'number'].includes(typeof value) || !/^[+-]?\d+(\.\d+)?$/.test(String(value).trim())) {
    throw new BrokerError('INVALID_RESPONSE', `${label} 응답을 확인할 수 없습니다.`);
  }
  const result = Number(value);
  if (!Number.isFinite(result) || Math.abs(result) > Number.MAX_SAFE_INTEGER) throw new BrokerError('INVALID_RESPONSE', `${label} 응답 범위를 확인할 수 없습니다.`);
  return result;
}
export function quantity(value: unknown, label: string): number {
  const result = amount(value, label);
  if (!Number.isSafeInteger(result) || result < 0) throw new BrokerError('INVALID_RESPONSE', `${label} 수량을 확인할 수 없습니다.`);
  return result;
}
export function records(data: Record<string, unknown>, field: string): Record<string, unknown>[] {
  const value = data[field];
  if (!Array.isArray(value) || value.some(row => !row || typeof row !== 'object' || Array.isArray(row))) {
    throw new BrokerError('INVALID_RESPONSE', '키움 목록 응답을 확인할 수 없습니다.');
  }
  return value as Record<string, unknown>[];
}
function checked(response: TransportResponse): TransportResponse {
  const code = amount(response.data.return_code, '키움 처리 코드');
  if (code !== 0) throw new BrokerError('REJECTED', '키움 모의투자 서버가 요청을 거절했습니다. 계좌 상태와 주문 조건을 확인하십시오.');
  return response;
}

/** The caller supplies a transport fixed to https://mockapi.kiwoom.com. */
export function kiwoomClient(credentials: BrokerCredentials, transport: Transport) {
  let token: { value: string; expiry: number } | undefined;
  let pendingToken: Promise<string> | undefined;
  async function authenticate(): Promise<string> {
    if (token && token.expiry > Date.now() + 60_000) return token.value;
    if (pendingToken) return pendingToken;
    pendingToken = (async () => {
      const { data } = checked(await transport('/oauth2/token', {
        method: 'POST', headers: { 'Content-Type': 'application/json;charset=UTF-8' },
        body: { grant_type: 'client_credentials', appkey: credentials.appKey, secretkey: credentials.appSecret },
      }));
      const value = requiredText(data.token, '접근 토큰');
      const expires = requiredText(data.expires_dt, '토큰 만료일');
      if (!/^\d{14}$/.test(expires) || requiredText(data.token_type, '토큰 유형').toLowerCase() !== 'bearer') {
        throw new BrokerError('INVALID_RESPONSE', '키움 토큰 형식을 확인할 수 없습니다.');
      }
      const expiry = Date.parse(`${expires.slice(0,4)}-${expires.slice(4,6)}-${expires.slice(6,8)}T${expires.slice(8,10)}:${expires.slice(10,12)}:${expires.slice(12,14)}+09:00`);
      if (!Number.isFinite(expiry) || expiry <= Date.now()) throw new BrokerError('INVALID_RESPONSE', '키움 토큰 만료일을 확인할 수 없습니다.');
      token = { value, expiry };
      return value;
    })();
    try { return await pendingToken; } finally { pendingToken = undefined; }
  }
  async function request(apiId: string, path: string, body: Record<string, string>, continuation?: string) {
    let authorization: string;
    try { authorization = `Bearer ${await authenticate()}`; }
    catch { throw new BrokerError('NOT_DISPATCHED', '키움 모의투자 인증을 완료하지 못해 업무 요청을 전송하지 않았습니다. 다시 시도하십시오.'); }
    return checked(await transport(path, {
      method: 'POST', body,
      headers: { 'Content-Type': 'application/json;charset=UTF-8', authorization,
        'api-id': apiId, ...(continuation ? { 'cont-yn': 'Y', 'next-key': continuation } : {}) },
    }));
  }
  async function pages(apiId: string, field: string, body: Record<string, string>) {
    const rows: Record<string, unknown>[] = [];
    const seen = new Set<string>();
    let continuation: string | undefined;
    do {
      const response = await request(apiId, '/api/dostk/acnt', body, continuation);
      rows.push(...records(response.data, field));
      const flag = response.headers.get('cont-yn');
      if (flag && !['Y', 'N'].includes(flag)) throw new BrokerError('INVALID_RESPONSE', '키움 연속조회 응답을 확인할 수 없습니다.');
      continuation = flag === 'Y' ? requiredText(response.headers.get('next-key'), '연속조회 키') : undefined;
      if (continuation && (seen.has(continuation) || seen.size >= 100)) throw new BrokerError('INVALID_RESPONSE', '키움 연속조회가 완료되지 않았습니다.');
      if (continuation) seen.add(continuation);
    } while (continuation);
    return rows;
  }
  return { request, pages };
}

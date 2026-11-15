import type { AccountSnapshot, BrokerOrder, BrokerProvider, OrderInput, Quote } from '../shared/broker.ts';
export interface BrokerAdapter {
  provider: BrokerProvider;
  getQuote(symbol: string): Promise<Quote>;
  getAccount(): Promise<AccountSnapshot>;
  getBuyingPower(symbol: string, price: number): Promise<number>;
  listOrders(): Promise<BrokerOrder[]>;
  placeOrder(input: OrderInput): Promise<BrokerOrder>;
  cancelOrder(order: BrokerOrder): Promise<{ cancellationId?: string }>;
}
export interface BrokerCredentials { appKey: string; appSecret: string; accountNumber?: string; accountProduct?: string }
export interface RequestOptions {
  method?: 'GET' | 'POST'; headers?: Record<string, string>;
  query?: Record<string, string>; body?: unknown;
}
export interface TransportResponse { data: Record<string, unknown>; headers: Headers }
export type Transport = (path: string, options?: RequestOptions) => Promise<TransportResponse>;

/** Errors never carry credential headers or raw upstream payloads to the client. */
export class BrokerError extends Error {
  code: string;
  constructor(code: string, message: string) { super(message); this.name = 'BrokerError'; this.code = code; }
}

/** Calendar day used by domestic order inquiries. */
export function koreaDate(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now).replaceAll('-', '');
}

/** Reject malformed financial fields rather than silently substituting zero. */
export function numeric(value: unknown, label: string): number {
  if ((typeof value !== 'string' && typeof value !== 'number') || String(value).trim() === '') throw new BrokerError('INVALID_RESPONSE', `${label} 응답을 확인할 수 없습니다.`);
  const result = Number(String(value).replaceAll(',', ''));
  if (!Number.isFinite(result)) throw new BrokerError('INVALID_RESPONSE', `${label} 응답을 확인할 수 없습니다.`);
  return result;
}

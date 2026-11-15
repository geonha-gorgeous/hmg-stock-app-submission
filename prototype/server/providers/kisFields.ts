import type { BrokerOrder } from '../../shared/broker.ts';
import { BrokerError, numeric } from '../contracts.ts';

export type Row = Record<string, unknown>;
export function invalid(): never { throw new BrokerError('INVALID_RESPONSE', '한국투자증권 응답을 확인할 수 없습니다.'); }
export function record(value: unknown): Row {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
  return value as Row;
}
export function text(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) return invalid();
  return value.trim();
}
export function rows(value: unknown): Row[] {
  if (!Array.isArray(value)) return invalid();
  return value.map(record);
}
export function success(data: Row): Row {
  if (data.rt_cd !== '0') {
    if (typeof data.rt_cd === 'string' && data.rt_cd.trim()) {
      throw new BrokerError('REJECTED', '한국투자증권이 요청을 거절했습니다. 계좌와 요청 내용을 확인해 주십시오.');
    }
    return invalid();
  }
  return data;
}
export function amount(value: unknown): number {
  const result = numeric(value, '금액');
  if (result < 0) return invalid();
  return result;
}
export function quantity(value: unknown): number {
  const result = amount(value);
  if (!Number.isSafeInteger(result)) return invalid();
  return result;
}
export function timestamp(date: unknown, time: unknown): string {
  const day = text(date), clock = text(time);
  if (!/^\d{8}$/.test(day) || !/^\d{6}$/.test(clock)) return invalid();
  const iso = `${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6)}T${clock.slice(0, 2)}:${clock.slice(2, 4)}:${clock.slice(4)}+09:00`;
  if (!Number.isFinite(Date.parse(iso))) return invalid();
  return iso;
}
export function orderId(date: string, number: string): string {
  if (!/^\d{1,10}$/.test(number)) return invalid();
  return `kis:${date}:${number.replace(/^0+(?=\d)/, '')}`;
}
export function mapOrder(row: Row): BrokerOrder {
  const date = text(row.ord_dt), number = text(row.odno);
  // Official legacy/rest/kis_api.py maps inquiry ord_gno_brno to cancellation KRX_FWDG_ORD_ORGNO.
  const organization = typeof row.ord_gno_brno === 'string' ? row.ord_gno_brno.trim() : '';
  const quantityValue = quantity(row.ord_qty), filled = quantity(row.tot_ccld_qty);
  const remaining = quantity(row.rmn_qty), cancelled = quantity(row.cnc_cfrm_qty), rejected = quantity(row.rjct_qty);
  if (quantityValue === 0 || filled + remaining + cancelled + rejected > quantityValue) return invalid();
  if (row.cncl_yn !== 'Y' && row.cncl_yn !== 'N') return invalid();
  if (row.sll_buy_dvsn_cd !== '01' && row.sll_buy_dvsn_cd !== '02') return invalid();
  // A successful inquiry alone does not establish execution or cancellation.
  let status: BrokerOrder['status'] = 'unknown';
  if (filled === quantityValue && remaining === 0) status = 'filled';
  else if (remaining === 0 && (cancelled > 0 || row.cncl_yn === 'Y')) status = 'cancelled';
  else if (remaining === 0 && rejected > 0) status = 'rejected';
  else if (remaining > 0 && filled > 0) status = 'partially_filled';
  else if (remaining === quantityValue && filled === 0 && cancelled === 0 && rejected === 0 && row.cncl_yn === 'N') status = 'accepted';
  return {
    brokerOrderId: orderId(date, number), symbol: text(row.pdno),
    side: row.sll_buy_dvsn_cd === '02' ? 'buy' : 'sell', quantity: quantityValue,
    price: amount(row.ord_unpr), filledQuantity: filled, remainingQuantity: remaining,
    status, submittedAt: timestamp(date, row.ord_tmd),
    meta: { date, number, organization, orderDivision: text(row.ord_dvsn_cd) },
  };
}

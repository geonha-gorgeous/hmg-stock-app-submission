import type { BrokerOrder, OrderStatus, Position } from '../../shared/broker.ts';
import { BrokerError } from '../contracts.ts';
import { amount, quantity, requiredText } from './kiwoom-client.ts';


export function orderId(date: string, rawNumber: unknown): string {
  const number = requiredText(rawNumber, '주문번호');
  if (!/^\d{8}$/.test(date) || !/^\d+$/.test(number) || /^0+$/.test(number)) {
    throw new BrokerError('INVALID_RESPONSE', '키움 주문 식별자를 확인할 수 없습니다.');
  }
  return `kiwoom:${date}:${number.replace(/^0+/, '')}`;
}

export function symbolCode(value: unknown): string {
  const symbol = requiredText(value, '종목코드').replace(/^A(?=\d{6}$)/, '');
  if (!/^\d{6}$/.test(symbol)) throw new BrokerError('INVALID_RESPONSE', 'KRX 종목코드를 확인할 수 없습니다.');
  return symbol;
}
export function mapPositions(rows: Record<string, unknown>[]): Position[] {
  const positions = new Map<string, Position>();
  for (const row of rows) {
    // Include all holdings; only cash lots can be sold through the cash-order API.
    const cashLot = requiredText(row.crd_tp, '신용구분') === '00';
    const symbol = symbolCode(row.stk_cd);
    const held = quantity(row.rmnd_qty, '보유수량');
    const available = quantity(row.trde_able_qty, '매매가능수량');
    const price = quantity(row.pur_pric, '매입가');
    if (available > held) throw new BrokerError('INVALID_RESPONSE', '키움 보유수량과 매매가능수량이 일치하지 않습니다.');
    const existing = positions.get(symbol);
    const total = (existing?.quantity ?? 0) + held;
    positions.set(symbol, {
      symbol, name: requiredText(row.stk_nm, '종목명'), quantity: total,
      availableQuantity: (existing?.availableQuantity ?? 0) + (cashLot ? available : 0),
      averagePrice: total ? ((existing?.averagePrice ?? 0) * (existing?.quantity ?? 0) + price * held) / total : price,
    });
  }
  return [...positions.values()];
}
function rowStatus(row: Record<string, unknown>, ordered: number, filled: number, remaining: number): OrderStatus {
  const acceptance = String(row.acpt_tp ?? '');
  const correction = String(row.mdfy_cncl ?? '');
  if (/거부|거절/.test(acceptance)) return 'rejected';
  if (/취소/.test(correction) && /확인|완료/.test(acceptance) && remaining === 0 &&
      quantity(row.cnfm_qty, '취소 확인수량') === ordered) return 'cancelled';
  if (filled === ordered && remaining === 0) return 'filled';
  if (remaining > 0 && filled > 0) return 'partially_filled';
  if (remaining === ordered && filled === 0 && /접수|확인/.test(acceptance)) return 'accepted';
  return 'unknown';
}
export function mapOrder(row: Record<string, unknown>, date: string): BrokerOrder {
  const sideText = requiredText(row.io_tp_nm, '매도수구분');
  const side = sideText.includes('매수') ? 'buy' : sideText.includes('매도') ? 'sell' : undefined;
  if (!side) throw new BrokerError('INVALID_RESPONSE', '키움 주문 매도수구분을 확인할 수 없습니다.');
  const ordered = quantity(row.ord_qty, '주문수량');
  const filled = quantity(row.cntr_qty, '체결수량');
  const remaining = quantity(row.ord_remnq, '주문잔량');
  if (!ordered || filled + remaining > ordered) throw new BrokerError('INVALID_RESPONSE', '키움 주문수량을 확인할 수 없습니다.');
  const time = requiredText(row.ord_tm, '주문시간').replaceAll(':', '');
  if (!/^\d{6}$/.test(time) || +time.slice(0,2) > 23 || +time.slice(2,4) > 59 || +time.slice(4,6) > 59) {
    throw new BrokerError('INVALID_RESPONSE', '키움 주문시간을 확인할 수 없습니다.');
  }
  const meta: Record<string, string> = { rawOrderNumber: requiredText(row.ord_no, '주문번호'), orderDate: date };
  for (const field of ['ori_ord', 'acpt_tp', 'mdfy_cncl', 'cnfm_qty', 'cnfm_tm', 'io_tp_nm', 'trde_tp', 'crd_tp']) {
    if (typeof row[field] === 'string') meta[field] = row[field];
  }
  return {
    symbol: symbolCode(row.stk_cd), side, quantity: ordered, price: Math.abs(amount(row.ord_uv, '주문가격')),
    brokerOrderId: orderId(date, row.ord_no), status: rowStatus(row, ordered, filled, remaining),
    filledQuantity: filled, remainingQuantity: remaining,
    submittedAt: `${date.slice(0,4)}-${date.slice(4,6)}-${date.slice(6,8)}T${time.slice(0,2)}:${time.slice(2,4)}:${time.slice(4,6)}+09:00`, meta,
  };
}

/** Preserve separate broker cancellation rows; update parent only on explicit confirmed cancellation. */
export function reconcileOrders(orders: BrokerOrder[]): BrokerOrder[] {
  const unique = new Map<string, BrokerOrder>();
  for (const order of orders) {
    const previous = unique.get(order.brokerOrderId);
    if (previous && JSON.stringify(previous) !== JSON.stringify(order)) {
      throw new BrokerError('INVALID_RESPONSE', '키움 주문번호의 중복 응답을 확인할 수 없습니다.');
    }
    unique.set(order.brokerOrderId, order);
  }
  for (const cancellation of unique.values()) {
    if (cancellation.status !== 'cancelled' || !cancellation.meta?.ori_ord) continue;
    if (/^0+$/.test(cancellation.meta.ori_ord)) continue;
    const parent = unique.get(orderId(cancellation.meta.orderDate, cancellation.meta.ori_ord));
    if (parent && parent.remainingQuantity === 0 && parent.filledQuantity < parent.quantity) parent.status = 'cancelled';
  }
  return [...unique.values()];
}

import { useEffect, useState } from 'react';
import { Check, Minus, Plus, ReceiptText } from 'lucide-react';
import type { AccountSnapshot, AppOrder, OrderInput, OrderStatus } from '../shared/broker';
import Modal from './Modal';
import OrderQuantityHelp from './OrderQuantityHelp';
import './order-layout.css';
import { won } from './market';
import type { OrderTicket } from './OrderSheet';

export const brokerStatusLabels: Record<OrderStatus, string> = {
  accepted: '접수', partially_filled: '부분 체결', filled: '체결', cancel_pending: '취소 확인 중', cancelled: '취소', rejected: '거절', unknown: '결과 확인 중',
};
const descriptions: Record<OrderStatus, string> = {
  accepted: '미체결 · 주문내역에서 확인해 주세요.',
  partially_filled: '잔여 수량을 확인해 주세요.',
  filled: '체결 확인 완료',
  cancel_pending: '취소 결과 확인 중', cancelled: '취소 확인 완료',
  rejected: '주문을 접수하지 못했습니다.', unknown: '접수·취소 결과를 확인하지 못했습니다. 같은 주문을 다시 보내지 말고 주문내역을 새로고침해 주세요.',
};
interface Props {
  ticket: OrderTicket; orders: AppOrder[]; account: AccountSnapshot | null; ready: boolean; cancelReady: boolean;
  pending: boolean; error: string | null; keyboardRestricted: boolean;
  buyingPower: (symbol: string, price: number) => Promise<number>;
  onPlace: (id: string, input: OrderInput) => Promise<void>; onCancel: (id: string) => Promise<void>;
  onRefresh: () => Promise<void>; onClose: () => void;
}
export default function BrokerOrderSheet({ ticket, orders, account, ready, cancelReady, pending, error, keyboardRestricted, buyingPower, onPlace, onCancel, onRefresh, onClose }: Props) {
  const [quantity, setQuantity] = useState(ticket.quantity);
  const [side, setSide] = useState(ticket.side);
  const [power, setPower] = useState<number | null>(null);
  const [powerError, setPowerError] = useState<string | null>(null);
  const [powerAttempt, setPowerAttempt] = useState(0);
  const order = orders.find(item => item.id === ticket.id);
  const position = account?.positions.find(item => item.symbol === ticket.stock.symbol);
  const availableQuantity = account ? position?.availableQuantity ?? 0 : null;
  useEffect(() => {
    let mounted = true;
    if (ready && !order && side === 'buy') {
      setPower(null); setPowerError(null);
      buyingPower(ticket.stock.symbol, ticket.stock.price).then(value => { if (mounted) setPower(value); }).catch(error => { if (mounted) setPowerError(error instanceof Error ? error.message : '주문 가능 금액을 조회하지 못했습니다.'); });
    }
    return () => { mounted = false; };
  }, [ticket.stock.symbol, ticket.stock.price, ready, order, side, buyingPower, powerAttempt]);
  const inputError = !ready ? '시세·계좌 연결 상태를 확인해 주세요.' : !Number.isInteger(quantity) || quantity < 1 ? '수량은 1주 단위로 입력해 주세요.' : side === 'buy' ? powerError ?? (power === null ? '주문 가능 금액을 조회하고 있습니다.' : quantity * ticket.stock.price > power ? '주문 가능 금액을 초과했습니다.' : null) : availableQuantity === null ? '매도 가능 수량을 조회하지 못했습니다.' : quantity > availableQuantity ? '매도 가능 수량을 초과했습니다.' : null;
  const footer = !order ? <>
    <div className="order-total"><span>예상 주문 금액</span><strong>{Number.isFinite(quantity * ticket.stock.price) ? won(quantity * ticket.stock.price) : '-'}원</strong></div>
    <p className="field-error" role="status">{inputError || error || '\u00a0'}</p>
    <button className={`full ${side === 'buy' ? 'buy-button' : 'sell-button'}`} disabled={pending || !!inputError} onClick={() => void onPlace(ticket.id, { symbol: ticket.stock.symbol, side, quantity, price: ticket.stock.price })}>{pending ? '모의 주문 전송 중' : `${quantity || 0}주 모의 ${side === 'buy' ? '매수' : '매도'}`}</button>
  </> : undefined;
  return <Modal title={order ? '모의 주문 결과' : `${ticket.stock.name} 모의 주문`} onClose={onClose} className={order ? '' : 'order-entry-modal'} bodyClassName="order-entry-body" footer={footer}>
    {order ? <div className="order-result">
      <div className={`result-icon ${order.status === 'filled' ? 'success' : ''}`}>{order.status === 'filled' ? <Check size={36}/> : <ReceiptText size={36}/>}</div>
      <span className="eyebrow">증권사 모의 주문</span><h3>{brokerStatusLabels[order.status]}</h3>
      <p>{ticket.stock.name} {order.quantity}주 · {order.side === 'buy' ? '매수' : '매도'}</p><strong>{won(order.price * order.quantity)}원</strong>
      <p className="subtle">{descriptions[order.status]}</p><p>체결 {order.status === 'unknown' ? '-' : order.filledQuantity}주 · 잔여 {order.status === 'unknown' ? '-' : order.remainingQuantity}주</p>
      {order.reason && <p className="field-error">{order.reason}</p>}
      <p className="field-error" role="status">{error}</p><div className="result-actions"><button className="primary" disabled={pending} onClick={() => void onRefresh()}>주문 상태 새로고침</button>
        {(order.status === 'accepted' || order.status === 'partially_filled') && <button className="secondary" disabled={pending || !cancelReady} onClick={() => void onCancel(order.id)}>{pending ? '요청 중' : '모의 주문 취소'}</button>}</div>
    </div> : <>
      <div className="order-conditions"><div className="segmented order-side" data-ccp-area="매수·매도"><button disabled={pending} className={side === 'buy' ? 'selected buy-text' : ''} onClick={() => setSide('buy')}>매수</button><button disabled={pending} className={side === 'sell' ? 'selected sell-text' : ''} onClick={() => setSide('sell')}>매도</button></div>
      <div className="order-price"><span>지정가</span><strong>{Number.isFinite(ticket.stock.price) ? won(ticket.stock.price) : '-'}<small> 원</small></strong></div>
      </div><div className="order-quantity"><div className="quantity-label"><span>수량</span><span className="subtle">매도 가능 {availableQuantity ?? '-'}주</span></div>
      <div className="quantity-control" data-ccp-adjust data-ccp-area="주문 수량"><button data-ccp-decrement aria-label="수량 줄이기" disabled={pending || quantity <= 1} onClick={() => setQuantity(Math.max(1, quantity - 1))}><Minus/></button><label><input aria-label="주문 수량" data-ccp-default inputMode="numeric" type="number" min="1" step="1" value={Number.isNaN(quantity) ? '' : quantity} readOnly={keyboardRestricted || pending} onChange={event => setQuantity(event.target.value === '' ? NaN : Number(event.target.value))}/><span>주</span></label><button data-ccp-increment aria-label="수량 늘리기" disabled={pending} onClick={() => setQuantity((Number.isFinite(quantity) ? quantity : 0) + 1)}><Plus/></button></div>
      <OrderQuantityHelp keyboardRestricted={keyboardRestricted}/>
      <div className="balance-row"><span>매수 가능 금액</span><span>{power === null ? '-' : won(power)}원</span></div>
      {powerError && <button className="secondary full order-retry" disabled={pending} onClick={() => setPowerAttempt(value => value + 1)}>주문 가능 금액 다시 조회</button>}
      </div>
    </>}
  </Modal>;
}

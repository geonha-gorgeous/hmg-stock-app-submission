import { useState } from 'react';
import { Check, Minus, Plus, ReceiptText } from 'lucide-react';
import Modal from './Modal';
import OrderQuantityHelp from './OrderQuantityHelp';
import './order-layout.css';
import { won } from './market';
import type { Stock } from './market';
import type { DemoOrder, DemoOrderEvent } from './domain';
import { validateOrder } from './domain';
import { getBalances } from './trading';

export interface OrderTicket { id: string; stock: Stock; side: 'buy' | 'sell'; quantity: number }
interface Props {
  ticket: OrderTicket; orders: DemoOrder[]; error: string | null;
  onPlace: (order: DemoOrder) => void; onEvent: (id: string, event: DemoOrderEvent) => void;
  onClose: () => void; keyboardRestricted: boolean;
}
export const statusLabels = { accepted: '접수', filled: '체결', cancelled: '취소', rejected: '거절' };
export default function OrderSheet({ ticket, orders, error, onPlace, onEvent, onClose, keyboardRestricted }: Props) {
  const [quantity, setQuantity] = useState(ticket.quantity);
  const [side, setSide] = useState(ticket.side);
  const order = orders.find(item => item.id === ticket.id);
  const balance = getBalances(orders, ticket.stock.symbol);
  const inputError = !Number.isInteger(quantity) ? '수량은 1주 단위로 입력해 주세요.' : validateOrder({ quantity, price: ticket.stock.price, side, ...balance });
  const action = side === 'buy' ? '매수' : '매도';
  const footer = !order ? <>
    <div className="order-total"><span>예상 주문 금액</span><strong>{Number.isFinite(quantity) ? won(quantity * ticket.stock.price) : '0'}원</strong></div>
    <p className="field-error" role="status">{inputError || error || '\u00a0'}</p>
    <button className={`full ${side === 'buy' ? 'buy-button' : 'sell-button'}`} disabled={!!inputError} onClick={() => onPlace({ id: ticket.id, symbol: ticket.stock.symbol, side, quantity, price: ticket.stock.price, status: 'accepted' })}>{quantity || 0}주 모의 {action}</button>
  </> : undefined;
  return <Modal title={order ? '주문 결과' : `${ticket.stock.name} 주문`} onClose={onClose} className={order ? '' : 'order-entry-modal'} bodyClassName="order-entry-body" footer={footer}>
    {order ? <div className="order-result">
      <div className={`result-icon ${order.status === 'filled' ? 'success' : ''}`}>{order.status === 'filled' ? <Check size={36}/> : <ReceiptText size={36}/>}</div>
      <span className="eyebrow">모의 주문</span><h3>{statusLabels[order.status]}되었습니다</h3>
      <p>{ticket.stock.name} {order.quantity}주 · {order.side === 'buy' ? '매수' : '매도'}</p>
      <strong>{won(order.price * order.quantity)}원</strong>
      <p className="subtle">{order.status === 'accepted' ? '미체결' : order.status === 'filled' ? '잔고 반영 완료' : '잔고 변동 없음'}</p>
      {order.status === 'accepted' ? <div className="result-actions"><button className="primary" onClick={() => onEvent(order.id, 'fill')}>체결 처리</button><button className="secondary" onClick={() => onEvent(order.id, 'cancel')}>접수 취소</button></div> : <button className="primary full" onClick={onClose}>확인</button>}
    </div> : <>
      <div className="order-conditions"><div className="segmented order-side" data-ccp-area="매수·매도"><button className={side === 'buy' ? 'selected buy-text' : ''} onClick={() => setSide('buy')}>매수</button><button className={side === 'sell' ? 'selected sell-text' : ''} onClick={() => setSide('sell')}>매도</button></div>
      <div className="order-price"><span>주문 가격</span><strong>{won(ticket.stock.price)}<small> 원</small></strong></div>
      </div><div className="order-quantity"><div className="quantity-label"><span>수량</span><span className="subtle">보유 {balance.held}주</span></div>
      <div className="quantity-control" data-ccp-adjust data-ccp-area="주문 수량"><button data-ccp-decrement aria-label="수량 줄이기" onClick={() => setQuantity(Math.max(1, (Number.isFinite(quantity) ? quantity : 1) - 1))} disabled={quantity <= 1}><Minus/></button>
        <label><input aria-label="주문 수량" data-ccp-default inputMode="numeric" type="number" min="1" step="1" value={Number.isNaN(quantity) ? '' : quantity} readOnly={keyboardRestricted} onChange={event => setQuantity(event.target.value === '' ? NaN : Number(event.target.value))}/><span>주</span></label>
        <button data-ccp-increment aria-label="수량 늘리기" onClick={() => setQuantity((Number.isFinite(quantity) ? quantity : 0) + 1)}><Plus/></button></div>
      <OrderQuantityHelp keyboardRestricted={keyboardRestricted}/>
      <div className="balance-row"><span>주문 가능 금액</span><span>{won(balance.availableCash)}원</span></div>
      </div>
    </>}
  </Modal>;
}

import type { BrokerOrder, OrderInput } from '../../shared/broker.ts';
import { BrokerError, koreaDate, type BrokerAdapter, type BrokerCredentials, type Transport } from '../contracts.ts';
import { amount, kiwoomClient, quantity, requiredText } from './kiwoom-client.ts';
import { mapOrder, mapPositions, orderId, reconcileOrders, symbolCode } from './kiwoom-mapping.ts';

/** KRX cash limit orders. The server's injected transport fixes the paper origin. */
export function createKiwoomAdapter(credentials: BrokerCredentials, transport: Transport): BrokerAdapter {
  const client = kiwoomClient(credentials, transport);
  function validateInput(input: OrderInput) {
    symbolCode(input.symbol);
    if (!['buy', 'sell'].includes(input.side) || !Number.isSafeInteger(input.quantity) || input.quantity <= 0 ||
        !Number.isSafeInteger(input.price) || input.price <= 0) {
      throw new BrokerError('INVALID_INPUT', '종목·매도수·정수 수량·지정가를 확인하십시오.');
    }
  }
  return {
    provider: 'kiwoom',
    async getQuote(symbol) {
      symbolCode(symbol);
      const { data } = await client.request('ka10001', '/api/dostk/stkinfo', { stk_cd: symbol });
      const responseSymbol = symbolCode(data.stk_cd);
      if (responseSymbol !== symbol) throw new BrokerError('INVALID_RESPONSE', '키움 시세 종목이 요청과 일치하지 않습니다.');
      return {
        symbol, name: requiredText(data.stk_nm, '종목명'),
        // Kiwoom current-price signs indicate direction, not a negative stock price.
        price: Math.abs(amount(data.cur_prc, '현재가')), change: amount(data.pred_pre, '전일대비'),
        percent: amount(data.flu_rt, '등락률'), asOf: new Date().toISOString(),
      };
    },
    async getAccount() {
      const rows = await client.pages('kt00018', 'acnt_evlt_remn_indv_tot', { qry_tp: '1', dmst_stex_tp: 'KRX' });
      const { data } = await client.request('kt00005', '/api/dostk/acnt', { dmst_stex_tp: 'KRX' });
      return { availableCash: amount(data.ord_alowa, '주문가능현금'), positions: mapPositions(rows), asOf: new Date().toISOString() };
    },
    async getBuyingPower(symbol, price) {
      validateInput({ symbol, price, side: 'buy', quantity: 1 });
      const { data } = await client.request('kt00011', '/api/dostk/acnt', { stk_cd: symbol, uv: String(price) });
      // The API gives both an amount and an executable quantity. Respect the tighter value.
      const availableAmount = quantity(data.min_ord_alow_amt, '미수불가주문가능금액');
      const availableQuantity = quantity(data.min_ord_alowq, '미수불가주문가능수량');
      return Math.min(availableAmount, availableQuantity * price);
    },
    async listOrders() {
      const date = koreaDate();
      const rows = await client.pages('kt00007', 'acnt_ord_cntr_prps_dtl', {
        ord_dt: date, qry_tp: '1', stk_bond_tp: '1', sell_tp: '0', stk_cd: '', fr_ord_no: '', dmst_stex_tp: 'KRX',
      });
      return reconcileOrders(rows.map(row => mapOrder(row, date)));
    },
    async placeOrder(input): Promise<BrokerOrder> {
      validateInput(input);
      const date = koreaDate();
      const { data } = await client.request(input.side === 'buy' ? 'kt10000' : 'kt10001', '/api/dostk/ordr', {
        dmst_stex_tp: 'KRX', stk_cd: input.symbol, ord_qty: String(input.quantity), ord_uv: String(input.price), trde_tp: '0', cond_uv: '',
      });
      return {
        ...input, brokerOrderId: orderId(date, data.ord_no), status: 'accepted',
        filledQuantity: 0, remainingQuantity: input.quantity, submittedAt: new Date().toISOString(), meta: { exchange: 'KRX', rawOrderNumber: requiredText(data.ord_no, '주문번호'), orderDate: date },
      };
    },
    async cancelOrder(order) {
      const rawNumber = requiredText(order.meta?.rawOrderNumber, '원주문번호');
      const date = requiredText(order.meta?.orderDate, '원주문일자');
      if (orderId(date, rawNumber) !== order.brokerOrderId || date !== koreaDate()) {
        throw new BrokerError('REJECTED', '오늘 접수한 키움 원주문만 취소할 수 있습니다.');
      }
      const { data } = await client.request('kt10003', '/api/dostk/ordr', {
        dmst_stex_tp: 'KRX', orig_ord_no: rawNumber,
        stk_cd: symbolCode(order.symbol), cncl_qty: '0',
      });
      // A cancellation acknowledgment does not prove that the original order was cancelled.
      return { cancellationId: requiredText(data.ord_no, '취소주문번호') };
    },
  };
}

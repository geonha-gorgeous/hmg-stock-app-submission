import type { BrokerOrder, OrderInput } from '../../shared/broker.ts';
import { BrokerError, koreaDate, numeric } from '../contracts.ts';
import type { BrokerAdapter, BrokerCredentials, RequestOptions, Transport } from '../contracts.ts';
import { amount, invalid, mapOrder, orderId, quantity, record, rows, success, text, timestamp } from './kisFields.ts';
import type { Row } from './kisFields.ts';

const TRADING = '/uapi/domestic-stock/v1/trading/';
const DAY = 24 * 60 * 60 * 1000;

/** PAPER transport is supplied by the server; no configurable live host or live TR exists here. */
export function createKisAdapter(credentials: BrokerCredentials, transport: Transport): BrokerAdapter {
  let cachedToken = '', expiresAt = 0, pendingToken: Promise<string> | undefined;
  const account = () => {
    if (!/^\d{8}$/.test(credentials.accountNumber ?? '') || !/^\d{2}$/.test(credentials.accountProduct ?? '')) {
      throw new BrokerError('CONFIGURATION', '한국투자증권 모의 계좌번호 8자리와 상품코드 2자리가 필요합니다.');
    }
    return { CANO: credentials.accountNumber!, ACNT_PRDT_CD: credentials.accountProduct! };
  };
  async function token(): Promise<string> {
    if (cachedToken && Date.now() < expiresAt) return cachedToken;
    if (!pendingToken) pendingToken = (async () => {
      const { data } = await transport('/oauth2/tokenP', { method: 'POST', body: {
        grant_type: 'client_credentials', appkey: credentials.appKey, appsecret: credentials.appSecret,
      } });
      if (data.error || (data.rt_cd !== undefined && data.rt_cd !== '0')) {
        throw new BrokerError('REJECTED', '한국투자증권 모의 인증 요청이 거절되었습니다.');
      }
      const value = text(data.access_token), seconds = amount(data.expires_in);
      if (seconds <= 0 || String(data.token_type).toLowerCase() !== 'bearer') return invalid();
      let expiry = Date.now() + Math.min(seconds * 1000, DAY);
      if (data.access_token_token_expired !== undefined) {
        const date = text(data.access_token_token_expired);
        if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(date)) return invalid();
        const absolute = Date.parse(date.replace(' ', 'T') + '+09:00');
        if (!Number.isFinite(absolute) || absolute <= Date.now()) return invalid();
        expiry = Math.min(expiry, absolute);
      }
      cachedToken = value; expiresAt = expiry - Math.min(60_000, seconds * 100);
      return value;
    })().finally(() => { pendingToken = undefined; });
    return pendingToken;
  }
  async function request(path: string, tr: string, options: RequestOptions = {}) {
    let authorization: string;
    try { authorization = `Bearer ${await token()}`; }
    catch (error) {
      if (options.method === 'POST') throw new BrokerError('NOT_DISPATCHED', '인증을 확인하지 못해 주문 요청을 전송하지 않았습니다. 연결 상태를 확인한 뒤 다시 시도해 주세요.');
      throw error;
    }
    const response = await transport(path, { ...options, headers: { ...options.headers,
      authorization, appkey: credentials.appKey, appsecret: credentials.appSecret,
      tr_id: tr, custtype: 'P', 'content-type': 'application/json; charset=utf-8',
    } });
    success(response.data);
    return response;
  }
  async function pages(path: string, tr: string, query: Record<string, string>): Promise<Row[]> {
    const result: Row[] = [], seen = new Set<string>();
    let fk = '', nk = '', continuation = '';
    for (let page = 0; page < 1000; page++) {
      const { data, headers } = await request(TRADING + path, tr, {
        query: { ...query, CTX_AREA_FK100: fk, CTX_AREA_NK100: nk }, headers: { tr_cont: continuation },
      });
      result.push(...rows(data.output1));
      const next = headers.get('tr_cont')?.trim() ?? '';
      if (!['M', 'F'].includes(next)) {
        if (!['', 'D', 'E'].includes(next)) return invalid();
        return result;
      }
      if (typeof data.ctx_area_fk100 !== 'string' || typeof data.ctx_area_nk100 !== 'string') return invalid();
      fk = data.ctx_area_fk100; nk = data.ctx_area_nk100;
      const cursor = `${fk}|${nk}`;
      if ((!fk.trim() && !nk.trim()) || seen.has(cursor)) return invalid();
      seen.add(cursor); continuation = 'N';
    }
    return invalid(); // Never silently return a truncated account or order list.
  }
  async function listOrders(): Promise<BrokerOrder[]> {
    const date = koreaDate();
    const result = await pages('inquire-daily-ccld', 'VTTC0081R', {
      ...account(), INQR_STRT_DT: date, INQR_END_DT: date, SLL_BUY_DVSN_CD: '00', PDNO: '',
      CCLD_DVSN: '00', INQR_DVSN: '00', INQR_DVSN_3: '01', ORD_GNO_BRNO: '', ODNO: '',
      INQR_DVSN_1: '', EXCG_ID_DVSN_CD: 'KRX',
    });
    const orders = result.map(mapOrder);
    if (orders.some(order => order.meta?.date !== date)) return invalid();
    return [...new Map(orders.map(order => [order.brokerOrderId, order])).values()];
  }
  function validateOrder(input: OrderInput) {
    if (!/^\d{6}$/.test(input.symbol) || !['buy', 'sell'].includes(input.side)
      || !Number.isSafeInteger(input.quantity) || input.quantity <= 0 || !Number.isSafeInteger(input.price) || input.price <= 0) {
      throw new BrokerError('INVALID_ORDER', '국내 주식 지정가 주문의 종목·수량·가격을 확인해 주십시오.');
    }
  }
  return {
    provider: 'kis',
    async getQuote(symbol) {
      const { data } = await request('/uapi/domestic-stock/v1/quotations/inquire-price', 'FHKST01010100', {
        query: { FID_COND_MRKT_DIV_CODE: 'J', FID_INPUT_ISCD: symbol },
      });
      const output = record(data.output);
      return { symbol, name: symbol, price: amount(output.stck_prpr), change: numeric(output.prdy_vrss, '전일 대비'),
        percent: numeric(output.prdy_ctrt, '등락률'), asOf: new Date().toISOString() };
    },
    async getAccount() {
      const positions = await pages('inquire-balance', 'VTTC8434R', { ...account(), AFHR_FLPR_YN: 'N', OFL_YN: '',
        INQR_DVSN: '02', UNPR_DVSN: '01', FUND_STTL_ICLD_YN: 'N', FNCG_AMT_AUTO_RDPT_YN: 'N', PRCS_DVSN: '00' });
      return { availableCash: null, asOf: new Date().toISOString(), positions: positions.map(row => ({
        symbol: text(row.pdno), name: text(row.prdt_name), quantity: quantity(row.hldg_qty),
        availableQuantity: quantity(row.ord_psbl_qty), averagePrice: amount(row.pchs_avg_pric),
      })) };
    },
    async getBuyingPower(symbol, price) {
      const { data } = await request(TRADING + 'inquire-psbl-order', 'VTTC8908R', { query: { ...account(),
        PDNO: symbol, ORD_UNPR: String(price), ORD_DVSN: '00', CMA_EVLU_AMT_ICLD_YN: 'N', OVRS_ICLD_YN: 'N' } });
      return amount(record(data.output).nrcvb_buy_amt);
    },
    listOrders,
    async placeOrder(input) {
      validateOrder(input);
      const date = koreaDate();
      const { data } = await request(TRADING + 'order-cash', input.side === 'buy' ? 'VTTC0012U' : 'VTTC0011U', {
        method: 'POST', body: { ...account(), PDNO: input.symbol, ORD_DVSN: '00', ORD_QTY: String(input.quantity),
          ORD_UNPR: String(input.price), EXCG_ID_DVSN_CD: 'KRX', SLL_TYPE: input.side === 'sell' ? '01' : '', CNDT_PRIC: '' },
      });
      const output = record(data.output), number = text(output.ODNO), organization = text(output.KRX_FWDG_ORD_ORGNO);
      return { ...input, brokerOrderId: orderId(date, number), status: 'accepted', filledQuantity: 0,
        remainingQuantity: input.quantity, submittedAt: timestamp(date, output.ORD_TMD),
        meta: { date, number, organization, orderDivision: '00' } };
    },
    async cancelOrder(order) {
      let current: BrokerOrder | undefined;
      try { current = (await listOrders()).find(item => item.brokerOrderId === order.brokerOrderId); }
      catch {
        throw new BrokerError('NOT_DISPATCHED', '주문 잔량을 확인하지 못해 취소 요청을 전송하지 않았습니다. 주문내역을 확인한 뒤 다시 시도해 주세요.');
      }
      if (!current || !['accepted', 'partially_filled'].includes(current.status) || current.remainingQuantity <= 0) {
        throw new BrokerError('REJECTED', '현재 취소할 수 있는 모의 주문 잔량을 확인할 수 없습니다.');
      }
      // Preserve exact placement routing when available; inquiry fallback follows the official sample.
      const organization = text(order.meta?.organization || current.meta?.organization);
      const { data } = await request(TRADING + 'order-rvsecncl', 'VTTC0013U', { method: 'POST', body: {
        ...account(), KRX_FWDG_ORD_ORGNO: organization, ORGN_ODNO: current.meta!.number,
        ORD_DVSN: current.meta!.orderDivision, RVSE_CNCL_DVSN_CD: '02', ORD_QTY: String(current.remainingQuantity),
        ORD_UNPR: '0', QTY_ALL_ORD_YN: 'Y', EXCG_ID_DVSN_CD: 'KRX',
      } });
      return { cancellationId: text(record(data.output).ODNO) };
    },
  };
}

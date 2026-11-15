import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RequestOptions, Transport, TransportResponse } from '../contracts.ts';
import { koreaDate } from '../contracts.ts';
import { createKiwoomAdapter } from './kiwoom.ts';
import { mapOrder, orderId, reconcileOrders } from './kiwoom-mapping.ts';

const credentials = { appKey: 'fixture-key', appSecret: 'fixture-secret' };
const token = { return_code: 0, token: 'fixture-token', token_type: 'bearer', expires_dt: '20990101000000' };
const ok = (fields: Record<string, unknown> = {}, headers: Record<string, string> = {}): TransportResponse => ({ data: { return_code: 0, ...fields }, headers: new Headers(headers) });
function mocked(handler: (path: string, options: RequestOptions) => ReturnType<typeof ok>) {
  const spy = vi.fn(async (path: string, options: RequestOptions = {}) => path === '/oauth2/token' ? ok(token) : handler(path, options));
  return { spy, adapter: createKiwoomAdapter(credentials, spy as Transport) };
}
const orderRow = (extra: Record<string, unknown> = {}) => ({
  ord_no: '0000050', stk_cd: 'A005930', io_tp_nm: '현금매수', ord_qty: '10', ord_uv: '60000',
  cntr_qty: '3', ord_remnq: '7', acpt_tp: '접수', mdfy_cncl: '', ori_ord: '0000000',
  cnfm_qty: '0', ord_tm: '13:05:43', ...extra,
});
afterEach(() => vi.useRealTimers());

describe('Kiwoom paper REST adapter', () => {
  it('memoizes concurrent OAuth and sends the documented body/header', async () => {
    const { adapter, spy } = mocked(() => ok({ stk_cd: '005930', stk_nm: '삼성전자', cur_prc: '-60000', pred_pre: '-1000', flu_rt: '-1.64' }));
    const [a, b] = await Promise.all([adapter.getQuote('005930'), adapter.getQuote('005930')]);
    expect(a).toMatchObject({ price: 60000, change: -1000, percent: -1.64 });
    expect(b.price).toBe(60000);
    expect(spy.mock.calls.filter(([path]) => path === '/oauth2/token')).toHaveLength(1);
    expect(spy.mock.calls[0][1]!).toMatchObject({ body: { grant_type: 'client_credentials', appkey: 'fixture-key', secretkey: 'fixture-secret' } });
    expect(spy.mock.calls[1][1]!).toMatchObject({ headers: { 'api-id': 'ka10001', authorization: 'Bearer fixture-token' }, body: { stk_cd: '005930' } });
  });
  it('rejects missing financial fields instead of manufacturing zero', async () => {
    const { adapter } = mocked(() => ok({ stk_cd: '005930', stk_nm: '삼성전자', cur_prc: '60000', pred_pre: '' }));
    await expect(adapter.getQuote('005930')).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
  it('maps all holdings but only cash lots to sellable quantity and follows pagination', async () => {
    let page = 0;
    const lot = { stk_cd: 'A005930', stk_nm: '삼성전자', rmnd_qty: '10', trde_able_qty: '8', pur_pric: '50000', crd_tp: '00' };
    const { adapter, spy } = mocked((_path, options) => {
      if (options.headers?.['api-id'] === 'kt00005') return ok({ ord_alowa: '300000' });
      return ++page === 1
        ? ok({ acnt_evlt_remn_indv_tot: [lot] }, { 'cont-yn': 'Y', 'next-key': 'fixture-page-2' })
        : ok({ acnt_evlt_remn_indv_tot: [{ ...lot, rmnd_qty: '5', trde_able_qty: '5', pur_pric: '80000', crd_tp: '03' }] }, { 'cont-yn': 'N' });
    });
    expect(await adapter.getAccount()).toMatchObject({ availableCash: 300000, positions: [{ symbol: '005930', quantity: 15, availableQuantity: 8, averagePrice: 60000 }] });
    expect(spy.mock.calls[2][1]!.headers).toMatchObject({ 'cont-yn': 'Y', 'next-key': 'fixture-page-2', 'api-id': 'kt00018' });
  });
  it('returns confirmed empty holdings and rejects missing arrays', async () => {
    const empty = mocked((_p, o) => o.headers?.['api-id'] === 'kt00018' ? ok({ acnt_evlt_remn_indv_tot: [] }) : ok({ ord_alowa: '0' }));
    expect(await empty.adapter.getAccount()).toMatchObject({ availableCash: 0, positions: [] });
    await expect(mocked(() => ok()).adapter.getAccount()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
  it('limits buying power using both provider no-borrowing amount and quantity', async () => {
    const { adapter, spy } = mocked(() => ok({ min_ord_alow_amt: '150000', min_ord_alowq: '2' }));
    expect(await adapter.getBuyingPower('005930', 60000)).toBe(120000);
    expect(spy.mock.calls[1][1]!).toMatchObject({ headers: { 'api-id': 'kt00011' }, body: { stk_cd: '005930', uv: '60000' } });
  });
  it('queries KST today and preserves the original pagination body', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-02T16:00:00Z'));
    let page = 0;
    const { adapter, spy } = mocked(() => ++page === 1
      ? ok({ acnt_ord_cntr_prps_dtl: [orderRow()] }, { 'cont-yn': 'Y', 'next-key': 'p2' })
      : ok({ acnt_ord_cntr_prps_dtl: [orderRow({ ord_no: '0000051', cntr_qty: '10', ord_remnq: '0' })] }));
    const orders = await adapter.listOrders();
    expect(orders.map(order => order.status)).toEqual(['partially_filled', 'filled']);
    expect(orders[0]).toMatchObject({ filledQuantity: 3, remainingQuantity: 7, submittedAt: '2026-11-03T13:05:43+09:00' });
    expect(spy.mock.calls[1][1]!.body).toMatchObject({ ord_dt: '20261103', stk_bond_tp: '1', dmst_stex_tp: 'KRX', stk_cd: '' });
    expect(spy.mock.calls[2][1]!.body).toEqual(spy.mock.calls[1][1]!.body);
  });
  it('does not treat zero remaining or cancellation receipt as a whole fill', () => {
    expect(mapOrder(orderRow({ cntr_qty: '3', ord_remnq: '0' }), '20261102')).toMatchObject({ status: 'unknown', filledQuantity: 3 });
    expect(mapOrder(orderRow({ cntr_qty: '0', ord_remnq: '0', mdfy_cncl: '취소', acpt_tp: '접수' }), '20261102').status).toBe('unknown');
  });
  it('requires explicit confirmed cancellation with the full confirmed quantity', () => {
    expect(mapOrder(orderRow({ cntr_qty: '0', ord_remnq: '0', mdfy_cncl: '취소', acpt_tp: '확인', cnfm_qty: '10' }), '20261102').status).toBe('cancelled');
    expect(mapOrder(orderRow({ cntr_qty: '0', ord_remnq: '0', mdfy_cncl: '취소', acpt_tp: '확인', cnfm_qty: '3' }), '20261102').status).toBe('unknown');
  });
  it('submits KRX cash limit buy/sell and preserves broker IDs', async () => {
    const { adapter, spy } = mocked(() => ok({ ord_no: '0000100', dmst_stex_tp: 'KRX' }));
    for (const side of ['buy', 'sell'] as const) {
      expect(await adapter.placeOrder({ symbol: '005930', side, quantity: 2, price: 60000 })).toMatchObject({ brokerOrderId: `kiwoom:${koreaDate()}:100`, status: 'accepted', filledQuantity: 0, remainingQuantity: 2 });
    }
    expect(spy.mock.calls[1][1]!).toMatchObject({ headers: { 'api-id': 'kt10000' }, body: { dmst_stex_tp: 'KRX', stk_cd: '005930', ord_qty: '2', ord_uv: '60000', trde_tp: '0', cond_uv: '' } });
    expect(spy.mock.calls[2][1]!.headers?.['api-id']).toBe('kt10001');
  });
  it('cancels remaining quantity without inventing a final status', async () => {
    const { adapter, spy } = mocked(() => ok({ ord_no: '0000101', base_orig_ord_no: '0000050', cncl_qty: '7' }));
    expect(await adapter.cancelOrder(mapOrder(orderRow(), koreaDate()))).toEqual({ cancellationId: '0000101' });
    expect(spy.mock.calls[1][1]!).toMatchObject({ headers: { 'api-id': 'kt10003' }, body: { orig_ord_no: '0000050', cncl_qty: '0', dmst_stex_tp: 'KRX', stk_cd: '005930' } });
  });
  it('distinguishes rejection, malformed data, and timeout without retry', async () => {
    const rejected = mocked(() => ({ data: { return_code: 20, return_msg: 'fixture sensitive payload' }, headers: new Headers() }));
    await expect(rejected.adapter.getBuyingPower('005930', 60000)).rejects.toMatchObject({ code: 'REJECTED' });
    const malformed = mocked(() => ({ data: {}, headers: new Headers() }));
    await expect(malformed.adapter.listOrders()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    const timeout = vi.fn(async () => { throw Object.assign(new Error('fixture timeout'), { code: 'TIMEOUT' }); });
    await expect(createKiwoomAdapter(credentials, timeout).listOrders()).rejects.toMatchObject({ code: 'NOT_DISPATCHED' });
    expect(timeout).toHaveBeenCalledTimes(1);
  });
  it.each(['NETWORK', 'TIMEOUT'])('keeps %s after actual business dispatch unchanged', async code => {
    const transport = vi.fn(async (path: string) => {
      if (path === '/oauth2/token') return ok(token);
      throw Object.assign(new Error('fixture upstream error'), { code });
    });
    await expect(createKiwoomAdapter(credentials, transport).placeOrder({ symbol: '005930', side: 'buy', quantity: 1, price: 60000 })).rejects.toMatchObject({ code });
    expect(transport.mock.calls.map(([path]) => path)).toEqual(['/oauth2/token', '/api/dostk/ordr']);
  });
  it('marks failed token issuance as not dispatched and permits a later cancellation attempt', async () => {
    let tokenAttempts = 0;
    const transport = vi.fn(async (path: string) => {
      if (path === '/oauth2/token') {
        if (++tokenAttempts === 1) return ok({ token: '' });
        return ok(token);
      }
      return ok({ ord_no: '51' });
    });
    const adapter = createKiwoomAdapter(credentials, transport);
    const order = mapOrder(orderRow(), koreaDate());
    await expect(adapter.cancelOrder(order)).rejects.toMatchObject({ code: 'NOT_DISPATCHED' });
    expect(transport.mock.calls.map(([path]) => path)).toEqual(['/oauth2/token']);
    expect(await adapter.cancelOrder(order)).toEqual({ cancellationId: '51' });
    expect(transport.mock.calls.map(([path]) => path)).toEqual(['/oauth2/token', '/oauth2/token', '/api/dostk/ordr']);
  });
  it('scopes IDs by KST day and normalizes padding consistently across placement/listing', async () => {
    const { adapter } = mocked((_p, o) => o.headers?.['api-id'] === 'kt10000'
      ? ok({ ord_no: '0000050' }) : ok({ acnt_ord_cntr_prps_dtl: [orderRow({ ord_no: '0000000050' })] }));
    const placed = await adapter.placeOrder({ symbol: '005930', side: 'buy', quantity: 10, price: 60000 });
    const [listed] = await adapter.listOrders();
    expect(placed.brokerOrderId).toBe(listed.brokerOrderId);
    expect(placed.meta).toMatchObject({ rawOrderNumber: '0000050', orderDate: koreaDate() });
    expect(listed.meta).toMatchObject({ rawOrderNumber: '0000000050', orderDate: koreaDate() });
    expect(orderId('20261102', '0000050')).not.toBe(orderId('20261103', '0000050'));
  });
  it('reconciles parent cancellation by date-scoped ID without crossing dates', () => {
    const first = mapOrder(orderRow({ cntr_qty: '3', ord_remnq: '0' }), '20261102');
    const second = mapOrder(orderRow({ cntr_qty: '3', ord_remnq: '0' }), '20261103');
    const cancellation = mapOrder(orderRow({ ord_no: '51', ori_ord: '00000050', cntr_qty: '0', ord_remnq: '0',
      mdfy_cncl: '취소', acpt_tp: '확인', cnfm_qty: '10' }), '20261103');
    expect(reconcileOrders([first, second, cancellation]).map(item => item.status)).toEqual(['unknown', 'cancelled', 'cancelled']);
  });
  it('rejects mismatched raw metadata and prior-day cancellation IDs before sending', async () => {
    const { adapter, spy } = mocked(() => ok({ ord_no: '51' }));
    const prior = mapOrder(orderRow(), '20200101');
    await expect(adapter.cancelOrder(prior)).rejects.toMatchObject({ code: 'REJECTED' });
    const mismatch = mapOrder(orderRow(), koreaDate());
    mismatch.meta!.rawOrderNumber = '99';
    await expect(adapter.cancelOrder(mismatch)).rejects.toMatchObject({ code: 'REJECTED' });
    expect(spy).not.toHaveBeenCalled();
  });
  it('rejects an endless page key instead of presenting an incomplete list', async () => {
    const { adapter } = mocked(() => ok({ acnt_ord_cntr_prps_dtl: [] }, { 'cont-yn': 'Y', 'next-key': 'repeat' }));
    await expect(adapter.listOrders()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
});

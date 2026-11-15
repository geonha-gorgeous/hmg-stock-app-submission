import { afterEach, describe, expect, it, vi } from 'vitest';
import { createKisAdapter } from './kis.ts';
import type { RequestOptions, Transport } from '../contracts.ts';
import { BrokerError, koreaDate } from '../contracts.ts';

const credentials = { appKey: 'test-key', appSecret: 'test-secret', accountNumber: '12345678', accountProduct: '01' };
type Reply = { data: Record<string, unknown>; headers?: Record<string, string>; error?: Error };
const token = { access_token: 'sanitized-token', token_type: 'Bearer', expires_in: 86400 };
const quote = { rt_cd: '0', output: { stck_prpr: '70000', prdy_vrss: '-100', prdy_ctrt: '-0.14' } };
function fixture(replies: Reply[]) {
  const calls: { path: string; options?: RequestOptions }[] = [];
  const transport: Transport = async (path, options) => {
    calls.push({ path, options });
    const next = replies.shift();
    if (!next) throw new Error('Unexpected mock request');
    if (next.error) throw next.error;
    return { data: next.data, headers: new Headers(next.headers) };
  };
  return { adapter: createKisAdapter(credentials, transport), calls };
}
function order(overrides: Record<string, unknown> = {}) {
  return { ord_dt: koreaDate(), ord_gno_brno: '12345', ord_orgno: '54321', odno: '000001', ord_qty: '10', tot_ccld_qty: '0',
    rmn_qty: '10', cnc_cfrm_qty: '0', rjct_qty: '0', cncl_yn: 'N', sll_buy_dvsn_cd: '02',
    pdno: '005930', ord_unpr: '70000', ord_tmd: '101500', ord_dvsn_cd: '00', ...overrides };
}
afterEach(() => vi.useRealTimers());

describe('KIS PAPER adapter (synthetic official-schema responses, no external calls)', () => {
  it('maps quote fields, auth headers and memoizes token', async () => {
    const { adapter, calls } = fixture([{ data: token }, { data: quote }, { data: quote }]);
    expect(await adapter.getQuote('005930')).toMatchObject({ symbol: '005930', price: 70000, change: -100, percent: -0.14 });
    await adapter.getQuote('005930');
    expect(calls).toHaveLength(3);
    expect(calls[0]).toMatchObject({ path: '/oauth2/tokenP', options: { method: 'POST', body: {
      grant_type: 'client_credentials', appkey: 'test-key', appsecret: 'test-secret' } } });
    expect(calls[1].options).toMatchObject({ headers: { authorization: 'Bearer sanitized-token',
      appkey: 'test-key', appsecret: 'test-secret', tr_id: 'FHKST01010100', custtype: 'P' },
      query: { FID_COND_MRKT_DIV_CODE: 'J', FID_INPUT_ISCD: '005930' } });
  });
  it('shares concurrent token issuance and refreshes after expiry', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-02T00:00:00Z'));
    const { adapter, calls } = fixture([{ data: { ...token, expires_in: 60 } }, { data: quote }, { data: quote },
      { data: token }, { data: quote }]);
    await Promise.all([adapter.getQuote('005930'), adapter.getQuote('005930')]);
    expect(calls.filter(call => call.path === '/oauth2/tokenP')).toHaveLength(1);
    vi.setSystemTime(new Date('2026-11-02T00:01:01Z')); await adapter.getQuote('005930');
    expect(calls.filter(call => call.path === '/oauth2/tokenP')).toHaveLength(2);
  });
  it('uses the earlier KST absolute token expiry', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-02T00:00:00Z'));
    const { adapter, calls } = fixture([{ data: { ...token, access_token_token_expired: '2026-11-02 09:02:00' } },
      { data: quote }, { data: token }, { data: quote }]);
    await adapter.getQuote('005930'); vi.setSystemTime(new Date('2026-11-02T00:02:01Z')); await adapter.getQuote('005930');
    expect(calls.filter(call => call.path === '/oauth2/tokenP')).toHaveLength(2);
  });
  it('paginates positions and avoids treating deposit balance as buying power', async () => {
    const position = { pdno: '005930', prdt_name: '삼성전자', hldg_qty: '10', ord_psbl_qty: '6', pchs_avg_pric: '68000' };
    const { adapter, calls } = fixture([{ data: token }, { data: { rt_cd: '0', output1: [position],
      output2: [{ dnca_tot_amt: '1000000' }], ctx_area_fk100: 'context', ctx_area_nk100: 'next' }, headers: { tr_cont: 'F' } },
      { data: { rt_cd: '0', output1: [] }, headers: { tr_cont: 'D' } }]);
    expect(await adapter.getAccount()).toMatchObject({ availableCash: null,
      positions: [{ symbol: '005930', quantity: 10, availableQuantity: 6, averagePrice: 68000 }] });
    expect(calls[2].options).toMatchObject({ query: { CTX_AREA_FK100: 'context', CTX_AREA_NK100: 'next' },
      headers: { tr_cont: 'N', tr_id: 'VTTC8434R' } });
  });
  it('reads non-margin buying amount for the requested symbol and price', async () => {
    const { adapter, calls } = fixture([{ data: token }, { data: { rt_cd: '0', output: { nrcvb_buy_amt: '1,000,000', max_buy_amt: '2500000' } } }]);
    expect(await adapter.getBuyingPower('005930', 70000)).toBe(1000000);
    expect(calls[1].options).toMatchObject({ headers: { tr_id: 'VTTC8908R' }, query: {
      CANO: '12345678', ACNT_PRDT_CD: '01', PDNO: '005930', ORD_UNPR: '70000', ORD_DVSN: '00',
      CMA_EVLU_AMT_ICLD_YN: 'N', OVRS_ICLD_YN: 'N' } });
  });
  it('maps accepted, partial fill, filled, partial-then-cancelled and rejected through all pages', async () => {
    const { adapter, calls } = fixture([{ data: token }, { data: { rt_cd: '0', output1: [order(), order({ odno: '2', tot_ccld_qty: '4', rmn_qty: '6' })],
      ctx_area_fk100: 'ctx', ctx_area_nk100: 'page2' }, headers: { tr_cont: 'M' } },
      { data: { rt_cd: '0', output1: [order({ odno: '3', tot_ccld_qty: '10', rmn_qty: '0' }),
        order({ odno: '4', tot_ccld_qty: '4', rmn_qty: '0', cnc_cfrm_qty: '6', cncl_yn: 'Y' }),
        order({ odno: '5', rmn_qty: '0', rjct_qty: '10' })] } }]);
    const orders = await adapter.listOrders();
    expect(orders.map(item => item.status)).toEqual(['accepted', 'partially_filled', 'filled', 'cancelled', 'rejected']);
    expect(orders[3]).toMatchObject({ filledQuantity: 4, remainingQuantity: 0 });
    expect(calls[1].options).toMatchObject({ headers: { tr_id: 'VTTC0081R' },
      query: { INQR_STRT_DT: koreaDate(), INQR_END_DT: koreaDate(), EXCG_ID_DVSN_CD: 'KRX' } });
    expect(calls[2].options?.headers?.tr_cont).toBe('N');
  });
  it.each(['buy', 'sell'] as const)('submits %s as limit cash and reports acceptance only', async side => {
    const { adapter, calls } = fixture([{ data: token }, { data: { rt_cd: '0', output: {
      ODNO: '000011', KRX_FWDG_ORD_ORGNO: '12345', ORD_TMD: '101500' } } }]);
    const result = await adapter.placeOrder({ symbol: '005930', side, quantity: 10, price: 70000 });
    expect(result).toMatchObject({ status: 'accepted', filledQuantity: 0, remainingQuantity: 10,
      brokerOrderId: `kis:${koreaDate()}:11` });
    expect(calls[1].options).toMatchObject({ headers: { tr_id: side === 'buy' ? 'VTTC0012U' : 'VTTC0011U' },
      body: { ORD_DVSN: '00', ORD_QTY: '10', ORD_UNPR: '70000', EXCG_ID_DVSN_CD: 'KRX' } });
  });
  it('refreshes remaining quantity and routes cancellation without cancelling filled shares', async () => {
    const { adapter, calls } = fixture([{ data: token }, { data: { rt_cd: '0', output1: [order({ tot_ccld_qty: '4', rmn_qty: '6' })] } },
      { data: { rt_cd: '0', output1: [order({ tot_ccld_qty: '5', rmn_qty: '5' })] } },
      { data: { rt_cd: '0', output: { ODNO: '000022' } } }]);
    const [current] = await adapter.listOrders();
    expect(await adapter.cancelOrder(current)).toEqual({ cancellationId: '000022' });
    expect(calls[3].options).toMatchObject({ headers: { tr_id: 'VTTC0013U' }, body: {
      KRX_FWDG_ORD_ORGNO: '12345', ORGN_ODNO: '000001', RVSE_CNCL_DVSN_CD: '02', ORD_QTY: '5', QTY_ALL_ORD_YN: 'Y' } });
  });
  it('does not cancel terminal or missing orders', async () => {
    const { adapter, calls } = fixture([{ data: token }, { data: { rt_cd: '0', output1: [order()] } },
      { data: { rt_cd: '0', output1: [order({ tot_ccld_qty: '10', rmn_qty: '0' })] } }]);
    const [current] = await adapter.listOrders();
    await expect(adapter.cancelOrder(current)).rejects.toMatchObject({ code: 'REJECTED' });
    expect(calls.some(call => call.path.endsWith('order-rvsecncl'))).toBe(false);
  });
  it('rejects explicit provider failure without exposing provider payload or credentials', async () => {
    const { adapter } = fixture([{ data: token }, { data: { rt_cd: '1', msg1: 'test-secret sensitive upstream payload' } }]);
    await expect(adapter.getQuote('005930')).rejects.toMatchObject({ code: 'REJECTED' });
  });
  it.each([{ rt_cd: '0', output: {} }, { output: quote.output }, { rt_cd: '0', output: { ...quote.output, stck_prpr: '' } }])(
    'rejects malformed or uncertain success response %#', async data => {
      const { adapter } = fixture([{ data: token }, { data }]);
      await expect(adapter.getQuote('005930')).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    });
  it('rejects malformed order acknowledgements instead of claiming acceptance', async () => {
    const { adapter } = fixture([{ data: token }, { data: { rt_cd: '0', output: { ODNO: '11' } } }]);
    await expect(adapter.placeOrder({ symbol: '005930', side: 'buy', quantity: 1, price: 70000 })).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
  it('fails a repeating pagination cursor instead of returning an incomplete list', async () => {
    const reply = { data: { rt_cd: '0', output1: [], ctx_area_fk100: 'ctx', ctx_area_nk100: 'loop' }, headers: { tr_cont: 'M' } };
    const { adapter } = fixture([{ data: token }, reply, reply]);
    await expect(adapter.listOrders()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
  it('does not infer a fill from zero remaining without execution evidence', async () => {
    const { adapter } = fixture([{ data: token }, { data: { rt_cd: '0', output1: [order({ rmn_qty: '0' })] } }]);
    expect((await adapter.listOrders())[0].status).toBe('unknown');
  });
  it('keeps routing from placement when inquiry omits organization and normalizes order number padding', async () => {
    const { adapter, calls } = fixture([{ data: token }, { data: { rt_cd: '0', output: {
      ODNO: '000001', KRX_FWDG_ORD_ORGNO: '12345', ORD_TMD: '101500' } } },
      { data: { rt_cd: '0', output1: [order({ odno: '0000000001', ord_gno_brno: '' })] } },
      { data: { rt_cd: '0', output: { ODNO: '22' } } }]);
    const placed = await adapter.placeOrder({ symbol: '005930', side: 'buy', quantity: 10, price: 70000 });
    await adapter.cancelOrder(placed);
    expect(calls[3].options?.body).toMatchObject({ KRX_FWDG_ORD_ORGNO: '12345', ORGN_ODNO: '0000000001' });
  });
  it('does not substitute an undocumented field for missing cancellation routing', async () => {
    const { adapter, calls } = fixture([{ data: token }, { data: { rt_cd: '0', output1: [order({ ord_gno_brno: '' })] } },
      { data: { rt_cd: '0', output1: [order({ ord_gno_brno: '' })] } }]);
    const [current] = await adapter.listOrders();
    await expect(adapter.cancelOrder(current)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    expect(calls.some(call => call.path.endsWith('order-rvsecncl'))).toBe(false);
  });
  it('rejects contradictory execution and cancelled quantity instead of declaring a fill', async () => {
    const { adapter } = fixture([{ data: token }, { data: { rt_cd: '0', output1: [
      order({ tot_ccld_qty: '10', rmn_qty: '0', cnc_cfrm_qty: '2' }),
    ] } }]);
    await expect(adapter.listOrders()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
  it.each([new BrokerError('TIMEOUT', 'sanitized'), new BrokerError('NETWORK', 'sanitized'), new Error('synthetic failure')])(
    'marks a failed cancellation preflight as NOT_DISPATCHED %#', async error => {
      const { adapter, calls } = fixture([{ data: token }, { data: { rt_cd: '0', output1: [order()] } }, { data: {}, error }]);
      const [current] = await adapter.listOrders();
      await expect(adapter.cancelOrder(current)).rejects.toMatchObject({ code: 'NOT_DISPATCHED' });
      expect(calls.some(call => call.path.endsWith('order-rvsecncl'))).toBe(false);
    });
  it.each(['TIMEOUT', 'NETWORK'])('marks failed auth before a write as NOT_DISPATCHED (%s)', async code => {
    const { adapter, calls } = fixture([{ data: {}, error: new BrokerError(code, 'sanitized') }]);
    await expect(adapter.placeOrder({ symbol: '005930', side: 'buy', quantity: 1, price: 70000 }))
      .rejects.toMatchObject({ code: 'NOT_DISPATCHED' });
    expect(calls.map(call => call.path)).toEqual(['/oauth2/tokenP']);
  });
  it('preserves a read auth failure without marking a write attempt', async () => {
    const { adapter } = fixture([{ data: {}, error: new BrokerError('TIMEOUT', 'sanitized') }]);
    await expect(adapter.getQuote('005930')).rejects.toMatchObject({ code: 'TIMEOUT' });
  });
  it.each(['TIMEOUT', 'NETWORK', 'INVALID_RESPONSE'])('preserves uncertainty after cancellation dispatch (%s)', async code => {
    const { adapter, calls } = fixture([{ data: token }, { data: { rt_cd: '0', output1: [order()] } },
      { data: { rt_cd: '0', output1: [order()] } }, { data: {}, error: new BrokerError(code, 'sanitized') }]);
    const [current] = await adapter.listOrders();
    await expect(adapter.cancelOrder(current)).rejects.toMatchObject({ code });
    expect(calls.filter(call => call.path.endsWith('order-rvsecncl'))).toHaveLength(1);
  });
  it('marks auth renewal failure between cancellation preflight and write as NOT_DISPATCHED', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-02T00:00:00Z'));
    const calls: string[] = [];
    const adapter = createKisAdapter(credentials, async path => {
      calls.push(path);
      if (path === '/oauth2/tokenP') {
        if (calls.length > 1) throw new BrokerError('TIMEOUT', 'sanitized');
        return { data: { ...token, expires_in: 60 }, headers: new Headers() };
      }
      if (path.endsWith('inquire-daily-ccld')) {
        vi.setSystemTime(new Date('2026-11-02T00:01:01Z'));
        return { data: { rt_cd: '0', output1: [order()] }, headers: new Headers() };
      }
      throw new Error('Unexpected mock write');
    });
    const current = { ...order(), brokerOrderId: `kis:${koreaDate()}:1`, symbol: '005930', side: 'buy' as const,
      quantity: 10, price: 70000, status: 'accepted' as const, filledQuantity: 0, remainingQuantity: 10,
      submittedAt: '2026-11-02T09:00:00+09:00', meta: { organization: '12345' } };
    await expect(adapter.cancelOrder(current)).rejects.toMatchObject({ code: 'NOT_DISPATCHED' });
    expect(calls).toEqual(['/oauth2/tokenP', '/uapi/domestic-stock/v1/trading/inquire-daily-ccld', '/oauth2/tokenP']);
  });
});

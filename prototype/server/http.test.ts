import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { request as httpRequest, type Server } from 'node:http';
import { readConfig } from './config.ts';
import { createApiServer } from './http.ts';
import { OrderJournal } from './journal.ts';
import { BrokerService } from './service.ts';
import type { BrokerAdapter } from './contracts.ts';

const servers: Server[] = [], directories: string[] = [];
afterEach(async () => { await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => server.close(() => resolve())))); for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });
async function setup(configured = true) {
  const config = readConfig({ BROKER_PROVIDER: 'kiwoom', ...(configured ? { KIWOOM_APP_KEY: 'test-key', KIWOOM_APP_SECRET: 'test-secret' } : {}) });
  const directory = mkdtempSync(join(tmpdir(), 'donda-http-')); directories.push(directory);
  const adapter: BrokerAdapter = { provider: 'kiwoom', getQuote: vi.fn(async symbol => ({ symbol, name: '테스트 종목', price: 70000, change: 100, percent: 0.1, asOf: new Date().toISOString() })), getAccount: vi.fn(async () => ({ availableCash: 1000000, positions: [], asOf: new Date().toISOString() })), getBuyingPower: vi.fn(async () => 1000000), listOrders: vi.fn(async () => []), placeOrder: vi.fn(async input => ({ ...input, brokerOrderId: 'test:1', filledQuantity: 0, remainingQuantity: input.quantity, status: 'accepted', submittedAt: new Date().toISOString() })), cancelOrder: vi.fn(async () => ({})) };
  const server = createApiServer(config, configured ? new BrokerService(adapter, new OrderJournal(directory, 'test')) : undefined);
  servers.push(server); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('No server');
  return { url: `http://127.0.0.1:${address.port}`, adapter };
}
describe('local brokerage API boundary', () => {
  it('exposes no credentials and requires same-origin session for mutations', async () => {
    const { url, adapter } = await setup();
    const status = await (await fetch(`${url}/api/status`)).json();
    expect(JSON.stringify(status)).not.toContain('test-secret');
    expect(JSON.stringify(status)).not.toContain('test-key');
    const data = JSON.stringify({ intentId: randomUUID(), symbol: '005930', side: 'buy', quantity: 2, price: 70000 });
    expect((await fetch(`${url}/api/orders`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: data })).status).toBe(403);
    expect((await fetch(`${url}/api/orders`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-donda-session': status.session, origin: 'https://untrusted.example' }, body: data })).status).toBe(403);
    const response = await fetch(`${url}/api/orders`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-donda-session': status.session, origin: 'http://127.0.0.1:4174' }, body: data });
    expect(response.status).toBe(200); expect((await response.json()).order.status).toBe('accepted');
    expect(adapter.placeOrder).toHaveBeenCalledTimes(1);
  });
  it('rejects DNS rebinding hosts and returns actionable missing config without fake data', async () => {
    const { url } = await setup(false);
    const hostStatus = await new Promise<number | undefined>((resolve, reject) => {
      const req = httpRequest(`${url}/api/status`, { headers: { host: 'attacker.example:4176' } }, response => { response.resume(); resolve(response.statusCode); });
      req.on('error', reject); req.end();
    });
    expect(hostStatus).toBe(403);
    const status = await (await fetch(`${url}/api/status`)).json();
    expect(status.configured).toBe(false); expect(status.missing).toContain('KIWOOM_APP_KEY');
    expect((await fetch(`${url}/api/quotes?symbols=005930`)).status).toBe(503);
  });
  it('checks quantities and bounded quote parameters before broker calls', async () => {
    const { url, adapter } = await setup();
    expect((await fetch(`${url}/api/quotes?symbols=wrong`)).status).toBe(400);
    expect(adapter.getQuote).not.toHaveBeenCalled();
    expect((await (await fetch(`${url}/api/account`)).json()).account.positions).toEqual([]);
    expect((await (await fetch(`${url}/api/buying-power?symbol=005930&price=70000`)).json()).availableCash).toBe(1000000);
  });
  it('fixes the current implementation to paper configuration and isolates account changes', () => {
    expect(() => readConfig({ BROKER_ENV: 'live' })).toThrow();
    expect(readConfig({ BROKER_PROVIDER: 'kiwoom', KIWOOM_APP_KEY: 'a' }).accountScope).not.toBe(readConfig({ BROKER_PROVIDER: 'kiwoom', KIWOOM_APP_KEY: 'b' }).accountScope);
    expect(readConfig({ BROKER_PROVIDER: 'kis', KIS_ACCOUNT_NUMBER: '12345678', KIS_ACCOUNT_PRODUCT: '01', KIS_APP_KEY: 'a' }).accountScope).toBe(readConfig({ BROKER_PROVIDER: 'kis', KIS_ACCOUNT_NUMBER: '12345678', KIS_ACCOUNT_PRODUCT: '01', KIS_APP_KEY: 'b' }).accountScope);
  });
});

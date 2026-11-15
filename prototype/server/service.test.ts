import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { BrokerOrder, OrderInput } from '../shared/broker.ts';
import { BrokerError } from './contracts.ts';
import type { BrokerAdapter } from './contracts.ts';
import { OrderJournal } from './journal.ts';
import { BrokerService } from './service.ts';

const directories: string[] = [];
const input: OrderInput = { symbol: '005930', side: 'buy', quantity: 2, price: 70000 };
const brokerOrder: BrokerOrder = { ...input, brokerOrderId: 'kis:20261102:123', status: 'accepted', filledQuantity: 0, remainingQuantity: 2, submittedAt: '2026-11-02T10:00:00+09:00', meta: { organization: 'placement-routing' } };
function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'donda-service-')); directories.push(directory);
  const adapter: BrokerAdapter = { provider: 'kis', getQuote: vi.fn(), getAccount: vi.fn(), getBuyingPower: vi.fn(), listOrders: vi.fn(async () => [{ ...brokerOrder, meta: { organization: 'inquiry-routing' } }]), placeOrder: vi.fn(async () => brokerOrder), cancelOrder: vi.fn(async () => ({ cancellationId: '456' })) };
  const journal = new OrderJournal(directory, 'test-account');
  return { directory, adapter, journal, service: new BrokerService(adapter, journal) };
}
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

describe('durable brokerage order lifecycle', () => {
  it('serializes duplicate requests and persists before a single broker dispatch', async () => {
    const { service, adapter, journal } = setup();
    const id = randomUUID();
    vi.mocked(adapter.placeOrder).mockImplementation(async () => {
      expect(JSON.parse(readFileSync(journal.file, 'utf8')).records[0][1].order.status).toBe('unknown');
      return brokerOrder;
    });
    const results = await Promise.all([service.place({ intentId: id, ...input }), service.place({ intentId: id, ...input })]);
    expect(adapter.placeOrder).toHaveBeenCalledTimes(1);
    expect(results[0]).toEqual(results[1]);
    expect(results[0].status).toBe('accepted');
    expect(results[0]).not.toHaveProperty('meta');
  });
  it('keeps a timeout unknown across process restart and never resends it', async () => {
    const { service, adapter, directory } = setup();
    const id = randomUUID();
    vi.mocked(adapter.placeOrder).mockRejectedValue(new BrokerError('TIMEOUT', 'timeout'));
    expect((await service.place({ intentId: id, ...input })).status).toBe('unknown');
    const restarted = new BrokerService(adapter, new OrderJournal(directory, 'test-account'));
    expect((await restarted.place({ intentId: id, ...input })).status).toBe('unknown');
    expect(adapter.placeOrder).toHaveBeenCalledTimes(1);
  });
  it('rejects reuse of an intent for changed input and validates numeric edge cases', async () => {
    const { service, adapter } = setup(); const id = randomUUID();
    await service.place({ intentId: id, ...input });
    await expect(service.place({ intentId: id, ...input, quantity: 3 })).rejects.toMatchObject({ code: 'CONFLICT' });
    for (const bad of [0, -1, 1.5, Number.MAX_SAFE_INTEGER, Infinity]) expect(() => service.place({ intentId: randomUUID(), ...input, quantity: bad })).toThrow();
    expect(adapter.placeOrder).toHaveBeenCalledTimes(1);
  });
  it('keeps a definitive broker rejection terminal for that intent', async () => {
    const { service, adapter } = setup();
    vi.mocked(adapter.placeOrder).mockRejectedValue(new BrokerError('REJECTED', '거절'));
    const data = { intentId: randomUUID(), ...input };
    expect((await service.place(data)).status).toBe('rejected');
    await service.place(data);
    expect(adapter.placeOrder).toHaveBeenCalledTimes(1);
  });
  it('reconciles partial fills, preserves original cancel routing, and waits for confirmed cancellation', async () => {
    const { service, adapter } = setup(); const id = randomUUID();
    await service.place({ intentId: id, ...input });
    vi.mocked(adapter.listOrders).mockResolvedValue([{ ...brokerOrder, status: 'partially_filled', filledQuantity: 1, remainingQuantity: 1, meta: { organization: 'inquiry-routing' } }]);
    expect((await service.list())[0]).toMatchObject({ id, status: 'partially_filled', filledQuantity: 1 });
    expect((await service.cancel(id)).status).toBe('cancel_pending');
    expect(vi.mocked(adapter.cancelOrder).mock.calls[0][0].meta?.organization).toBe('placement-routing');
    await service.cancel(id);
    expect(adapter.cancelOrder).toHaveBeenCalledTimes(1);
    expect((await service.list())[0].status).toBe('cancel_pending');
    vi.mocked(adapter.listOrders).mockResolvedValue([{ ...brokerOrder, status: 'cancelled', filledQuantity: 1, remainingQuantity: 0 }]);
    expect((await service.list())[0]).toMatchObject({ status: 'cancelled', filledQuantity: 1, remainingQuantity: 0 });
  });
  it('does not retry ambiguous cancellation and does not turn cancellation into a fill', async () => {
    const { service, adapter } = setup(); const id = randomUUID();
    await service.place({ intentId: id, ...input });
    vi.mocked(adapter.cancelOrder).mockRejectedValue(new BrokerError('NETWORK', 'network'));
    expect((await service.cancel(id)).status).toBe('cancel_pending');
    await service.cancel(id);
    expect(adapter.cancelOrder).toHaveBeenCalledTimes(1);
  });
  it('keeps each configured account in its own journal', async () => {
    const { service, adapter, directory } = setup();
    await service.place({ intentId: randomUUID(), ...input });
    const other = new BrokerService(adapter, new OrderJournal(directory, 'other-account'));
    expect(other.journal.records.size).toBe(0);
  });
  it('normalizes UUID case and reuses cancellation state across local and broker IDs', async () => {
    const { service, adapter, journal } = setup(); const id = randomUUID();
    await service.place({ intentId: id, ...input });
    await service.place({ intentId: id.toUpperCase(), ...input });
    expect(adapter.placeOrder).toHaveBeenCalledTimes(1);
    await service.cancel(id);
    await service.cancel(`broker:${brokerOrder.brokerOrderId}`);
    expect(adapter.cancelOrder).toHaveBeenCalledTimes(1);
    expect(journal.records.size).toBe(1);
  });
  it('allows cancellation retry only after a confirmed pre-dispatch failure', async () => {
    const { service, adapter } = setup(); const id = randomUUID();
    await service.place({ intentId: id, ...input });
    vi.mocked(adapter.cancelOrder).mockRejectedValueOnce(new BrokerError('NOT_DISPATCHED', '조회 실패'));
    expect((await service.cancel(id)).status).toBe('accepted');
    expect((await service.cancel(id)).status).toBe('cancel_pending');
    expect(adapter.cancelOrder).toHaveBeenCalledTimes(2);
  });
});

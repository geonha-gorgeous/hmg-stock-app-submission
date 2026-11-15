import type { AppOrder, BrokerOrder, OrderInput } from '../shared/broker.ts';
import { BrokerError } from './contracts.ts';
import type { BrokerAdapter } from './contracts.ts';
import { OrderJournal } from './journal.ts';

/** Only validated order fields enter the durable request journal. */
export function validateInput(value: unknown): { intentId: string; input: OrderInput } {
  if (!value || typeof value !== 'object') throw new BrokerError('INVALID_INPUT', '주문 입력을 확인해 주세요.');
  const body = value as Record<string, unknown>;
  if (typeof body.intentId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.intentId)) throw new BrokerError('INVALID_INPUT', '주문 요청 식별자를 확인해 주세요.');
  if (typeof body.symbol !== 'string' || !/^\d{6}$/.test(body.symbol) || !['buy', 'sell'].includes(String(body.side)) || !Number.isSafeInteger(body.quantity) || Number(body.quantity) <= 0 || !Number.isSafeInteger(body.price) || Number(body.price) <= 0 || !Number.isSafeInteger(Number(body.price) * Number(body.quantity))) throw new BrokerError('INVALID_INPUT', '종목·수량·가격을 확인해 주세요.');
  return { intentId: body.intentId.toLowerCase(), input: { symbol: body.symbol, side: body.side as OrderInput['side'], quantity: Number(body.quantity), price: Number(body.price) } };
}

/** Reconciles actual broker orders without replaying an ambiguous submission. */
export class BrokerService {
  adapter: BrokerAdapter;
  journal: OrderJournal;
  private queue: Promise<unknown> = Promise.resolve();
  constructor(adapter: BrokerAdapter, journal: OrderJournal) { this.adapter = adapter; this.journal = journal; }
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const result = this.queue.then(work);
    this.queue = result.catch(() => undefined);
    return result;
  }
  place(body: unknown): Promise<AppOrder> {
    const { intentId, input } = validateInput(body);
    return this.serial(async () => {
      const previous = this.journal.records.get(intentId);
      if (previous) {
        if (JSON.stringify(previous.input) !== JSON.stringify(input)) throw new BrokerError('CONFLICT', '같은 요청 식별자로 다른 주문을 보낼 수 없습니다.');
        return previous.order;
      }
      const order: AppOrder = { ...input, id: intentId, status: 'unknown', filledQuantity: 0, remainingQuantity: input.quantity, submittedAt: new Date().toISOString(), reason: '증권사 접수 여부를 확인하고 있습니다.' };
      const record = { input, order } as import('./journal.ts').OrderRecord;
      this.journal.records.set(intentId, record);
      this.journal.save();
      try {
        const broker = await this.adapter.placeOrder(input);
        record.broker = broker;
        record.order = this.publicOrder(broker, intentId);
      } catch (error) {
        const rejected = error instanceof BrokerError && ['REJECTED', 'NOT_DISPATCHED'].includes(error.code);
        record.order = { ...order, status: rejected ? 'rejected' : 'unknown', reason: rejected ? error.message : '응답을 확인하지 못했습니다. 같은 주문을 다시 전송하지 않고 주문내역을 확인해 주세요.' };
      }
      this.journal.save();
      return record.order;
    });
  }
  list(): Promise<AppOrder[]> {
    return this.serial(async () => {
      const remote = await this.adapter.listOrders();
      const matched = new Set<string>();
      for (const record of this.journal.records.values()) {
        if (!record.broker) continue;
        const broker = remote.find(order => order.brokerOrderId === record.broker!.brokerOrderId);
        if (!broker) continue;
        record.broker = { ...broker, meta: { ...broker.meta, ...record.broker.meta } };
        record.order = this.publicOrder(broker, record.order.id);
        if (record.cancelRequested && ['accepted', 'partially_filled'].includes(broker.status)) record.order.status = 'cancel_pending';
        matched.add(broker.brokerOrderId);
      }
      this.journal.save();
      return [...this.journal.records.values()].map(record => record.order)
        .concat(remote.filter(order => !matched.has(order.brokerOrderId)).map(order => this.publicOrder(order, `broker:${order.brokerOrderId}`)))
        .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
    });
  }
  cancel(id: string): Promise<AppOrder> {
    return this.serial(async () => {
      let record = this.journal.records.get(id.toLowerCase());
      const remote = await this.adapter.listOrders();
      const broker = remote.find(order => order.brokerOrderId === (record?.broker?.brokerOrderId || id.replace(/^broker:/, '')));
      if (!broker) throw new BrokerError('NOT_FOUND', '증권사에서 취소할 주문을 확인하지 못했습니다.');
      record = record || [...this.journal.records.values()].find(item => item.broker?.brokerOrderId === broker.brokerOrderId);
      id = record?.order.id || id;
      if (!record) {
        const { symbol, side, quantity, price } = broker;
        record = { input: { symbol, side, quantity, price }, broker, order: this.publicOrder(broker, id) };
        this.journal.records.set(id, record);
      }
      record.broker = { ...broker, meta: { ...broker.meta, ...record.broker?.meta } };
      if (!['accepted', 'partially_filled'].includes(broker.status) || broker.remainingQuantity <= 0) {
        record.order = this.publicOrder(broker, id); this.journal.save(); return record.order;
      }
      if (record.cancelRequested) return record.order;
      record.cancelRequested = true;
      record.order = { ...this.publicOrder(broker, id), status: 'cancel_pending', reason: '취소 접수·완료 여부를 조회하고 있습니다.' };
      this.journal.save();
      try { await this.adapter.cancelOrder(record.broker); }
      catch (error) {
        if (error instanceof BrokerError && ['REJECTED', 'NOT_DISPATCHED'].includes(error.code)) {
          record.cancelRequested = false;
          record.order = { ...this.publicOrder(broker, id), reason: error.message };
        } else record.order.reason = '취소 응답을 확인하지 못했습니다. 주문내역을 조회해 주세요.';
      }
      this.journal.save();
      return record.order;
    });
  }
  private publicOrder(broker: BrokerOrder, id: string): AppOrder {
    const { meta: _meta, ...order } = broker;
    return { ...order, id };
  }
}

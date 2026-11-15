import { describe, expect, it } from 'vitest';
import { getBalances, initialTradingState, tradingReducer } from './trading';
import type { DemoOrder } from './domain';

const order: DemoOrder = { id: 'one', symbol: '005930', side: 'buy', quantity: 2, price: 70500, status: 'accepted' };
describe('demo account lifecycle', () => {
  it('reserves on acceptance, updates holdings only on fill, and ignores duplicate placement/fill', () => {
    const accepted = tradingReducer(initialTradingState, { type: 'place', order });
    expect(getBalances(accepted.orders, order.symbol)).toEqual({ cash:3000000, held:10, availableCash:2859000, availableQuantity:10 });
    const duplicate = tradingReducer(accepted, { type: 'place', order });
    expect(duplicate.orders).toHaveLength(1);
    const filled = tradingReducer(duplicate, { type: 'transition', id: order.id, event: 'fill' });
    const repeated = tradingReducer(filled, { type: 'transition', id: order.id, event: 'fill' });
    expect(getBalances(repeated.orders, order.symbol)).toEqual({ cash:2859000, held:12, availableCash:2859000, availableQuantity:12 });
  });
  it('releases reservations after cancellation and cannot later fill', () => {
    const accepted = tradingReducer(initialTradingState, { type: 'place', order });
    const cancelled = tradingReducer(accepted, { type: 'transition', id: order.id, event: 'cancel' });
    const late = tradingReducer(cancelled, { type: 'transition', id: order.id, event: 'fill' });
    expect(getBalances(late.orders, order.symbol).availableCash).toBe(3000000);
    expect(late.orders[0].status).toBe('cancelled');
  });
  it('prevents overselling when another accepted sell has reserved shares', () => {
    const accepted = tradingReducer(initialTradingState, { type: 'place', order: { ...order, side:'sell', quantity:8 } });
    const excess = tradingReducer(accepted, { type: 'place', order: { ...order, id:'two', side:'sell', quantity:3 } });
    expect(excess.orders).toHaveLength(1); expect(excess.error).toContain('수량');
  });
  it('prevents a second buy from spending already reserved funds', () => {
    const accepted = tradingReducer(initialTradingState, { type: 'place', order: { ...order, quantity:40 } });
    const excess = tradingReducer(accepted, { type: 'place', order: { ...order, id:'two', quantity:10 } });
    expect(excess.orders).toHaveLength(1); expect(excess.error).toContain('금액');
  });
  it('rejects fractional and non-finite quantities without changing balances', () => {
    for (const quantity of [0, -1, 0.5, NaN, Infinity]) {
      const state = tradingReducer(initialTradingState, { type: 'place', order: { ...order, quantity } });
      expect(state.orders).toHaveLength(0); expect(state.error).toBeTruthy();
    }
  });
});

import { useReducer } from 'react';
import { stocks } from './market';
import { transitionOrder, validateOrder } from './domain';
import type { DemoOrder, DemoOrderEvent } from './domain';

export interface TradingState { orders: DemoOrder[]; error: string | null }
export type TradingAction = { type: 'place'; order: DemoOrder } | { type: 'transition'; id: string; event: DemoOrderEvent };
export const initialTradingState: TradingState = { orders: [], error: null };

/** Filled orders change holdings; accepted orders reserve only the required funds/shares. */
export function getBalances(orders: DemoOrder[], symbol: string) {
  let cash = 3000000;
  let held = stocks.find(stock => stock.symbol === symbol)?.held ?? 0;
  let reservedCash = 0;
  let reservedShares = 0;
  for (const order of orders) {
    if (order.status === 'filled') {
      cash += (order.side === 'buy' ? -1 : 1) * order.price * order.quantity;
      if (order.symbol === symbol) held += (order.side === 'buy' ? 1 : -1) * order.quantity;
    }
    if (order.status === 'accepted') {
      if (order.side === 'buy') reservedCash += order.price * order.quantity;
      else if (order.symbol === symbol) reservedShares += order.quantity;
    }
  }
  return { cash, held, availableCash: cash - reservedCash, availableQuantity: held - reservedShares };
}

/** A stable ticket ID prevents duplicate placement before a render has completed. */
export function tradingReducer(state: TradingState, action: TradingAction): TradingState {
  if (action.type === 'transition') return { ...state, orders: state.orders.map(order => order.id === action.id ? transitionOrder(order, action.event) : order) };
  if (state.orders.some(order => order.id === action.order.id)) return state;
  const order = action.order;
  const balance = getBalances(state.orders, order.symbol);
  const error = !Number.isInteger(order.quantity) ? '수량은 1주 단위로 입력해 주세요.' : validateOrder({ ...order, ...balance });
  if (error) return { ...state, error };
  return { orders: [{ ...order, status: 'accepted' }, ...state.orders], error: null };
}
export function useTrading() { return useReducer(tradingReducer, initialTradingState); }

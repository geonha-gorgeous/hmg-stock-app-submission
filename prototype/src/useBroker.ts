import { useCallback, useEffect, useRef, useState } from 'react';
import type { AccountSnapshot, AppOrder, BrokerStatus, OrderInput, Quote } from '../shared/broker';
import { blank, BrokerError, failed, received, reconcileOrders, request } from './brokerClient';
import { stocks } from './market';
import { BrokerSessionScope } from './brokerSession';

export default function useBroker() {
  const [status, setStatus] = useState<BrokerStatus | null>(null);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [quotes, setQuotes] = useState(blank<Quote[]>);
  const [account, setAccount] = useState(blank<AccountSnapshot>);
  const [orders, setOrders] = useState(blank<AppOrder[]>);
  const [refreshing, setRefreshing] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const [pending, setPending] = useState(false);
  const [orderError, setOrderError] = useState<string | null>(null);
  const refreshingRef = useRef(false);
  const mutationRef = useRef(false);
  const scope = useRef(new BrokerSessionScope());
  const checkingRef = useRef(true);
  const refresh = useCallback(async () => {
    if (refreshingRef.current) return;
    refreshingRef.current = true; setRefreshing(true); checkingRef.current = true; setCheckingSession(true);
    try {
      const next = await request<BrokerStatus>('/status');
      if (scope.current.accept(next)) {
        setQuotes(blank()); setAccount(blank()); setOrders(blank());
        mutationRef.current = false; setPending(false); setOrderError(null);
      }
      const version = scope.current.version;
      setStatus(next); setConnectionError(null); checkingRef.current = false; setCheckingSession(false);
      if (next.provider !== 'demo' && next.configured) {
        try { const result = await request<{ quotes: Quote[] }>(`/quotes?symbols=${stocks.map(stock => stock.symbol).join(',')}`); if (scope.current.current(version)) setQuotes(received(result.quotes)); }
        catch (error) { setQuotes(previous => failed(previous, error)); }
        try { const result = await request<{ account: AccountSnapshot }>('/account'); if (scope.current.current(version)) setAccount(received(result.account)); }
        catch (error) { setAccount(previous => failed(previous, error)); }
        try { const result = await request<{ orders: AppOrder[] }>('/orders'); if (scope.current.current(version)) setOrders(previous => received(reconcileOrders(result.orders, previous.value ?? []))); }
        catch (error) { setOrders(previous => failed(previous, error)); }
      }
    } catch (error) { setConnectionError(error instanceof Error ? error.message : '서버에 연결할 수 없습니다.'); }
    finally { refreshingRef.current = false; setRefreshing(false); checkingRef.current = false; setCheckingSession(false); }
  }, []);
  useEffect(() => { void refresh(); const timer = setInterval(() => void refresh(), 60000); return () => clearInterval(timer); }, [refresh]);
  const buyingPower = useCallback(async (symbol: string, price: number) => {
    const version = scope.current.version;
    const result = await request<{ availableCash: number }>(`/buying-power?symbol=${encodeURIComponent(symbol)}&price=${price}`);
    if (!scope.current.current(version)) throw new BrokerError('계좌 연결이 변경되었습니다. 주문을 다시 열어 주세요.', 'SESSION_CHANGED');
    return result.availableCash;
  }, []);
  const place = async (id: string, input: OrderInput) => {
    const current = scope.current.status;
    const version = scope.current.version;
    if (checkingRef.current || mutationRef.current || scope.current.attempted.has(id) || !current?.configured || current.provider === 'demo' || connectionError) return;
    mutationRef.current = true; scope.current.attempted.add(id); setPending(true); setOrderError(null);
    try {
      const result = await request<{ order: AppOrder }>('/orders', current.session, { intentId: id, ...input });
      if (!scope.current.current(version)) return;
      setOrders(previous => received([result.order, ...(previous.value ?? []).filter(order => order.id !== id)]));
    } catch (error) {
      if (!scope.current.current(version)) return;
      setOrderError(error instanceof Error ? error.message : '주문 응답을 확인하지 못했습니다.');
      const ambiguous = !(error instanceof BrokerError) || error.ambiguous;
      const order: AppOrder = { ...input, id, status: ambiguous ? 'unknown' : 'rejected', filledQuantity: 0, remainingQuantity: input.quantity, submittedAt: new Date().toISOString(), reason: ambiguous ? '접수 여부를 확인 중입니다. 주문내역을 새로고침해 주세요.' : error.message };
      setOrders(previous => ({ ...previous, value: [order, ...(previous.value ?? []).filter(item => item.id !== id)] }));
    } finally { if (scope.current.current(version)) { mutationRef.current = false; setPending(false); void refresh(); } }
  };
  const cancel = async (id: string) => {
    const current = scope.current.status;
    const version = scope.current.version;
    if (checkingRef.current || mutationRef.current || !current || connectionError) return;
    mutationRef.current = true; setPending(true); setOrderError(null);
    try {
      const result = await request<{ order: AppOrder }>(`/orders/${encodeURIComponent(id)}/cancel`, current.session, {});
      if (!scope.current.current(version)) return;
      setOrders(previous => ({ ...previous, value: previous.value?.map(order => order.id === id ? result.order : order) ?? [] }));
    } catch (error) {
      if (!scope.current.current(version)) return;
      setOrderError(error instanceof Error ? error.message : '취소 응답을 확인하지 못했습니다.');
      if (!(error instanceof BrokerError) || error.ambiguous) setOrders(previous => ({ ...previous, value: previous.value?.map(order => order.id === id ? { ...order, status: 'unknown', reason: '취소 결과를 확인 중입니다.' } : order) ?? [] }));
    } finally { if (scope.current.current(version)) { mutationRef.current = false; setPending(false); void refresh(); } }
  };
  return { clearOrderError: () => setOrderError(null), status, checkingSession, connectionError, quotes, account, orders, refreshing, pending, orderError, refresh, buyingPower, place, cancel };
}

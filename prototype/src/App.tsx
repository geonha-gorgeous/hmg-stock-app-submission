import { useEffect, useState } from 'react';
import { AudioLines, ChevronRight, CircleHelp, Clock3, CircleDot, Maximize2, Minimize2, Moon, ReceiptText, SlidersHorizontal, Star, Sun, Wifi, X, Zap } from 'lucide-react';
import { stocks, won, marketBrief } from './market';
import type { Stock } from './market';
import { UXR, vehicleScenarios } from './domain';
import type { VehicleState } from './domain';
import { getBalances, useTrading } from './trading';
import OrderSheet, { statusLabels } from './OrderSheet';
import type { OrderTicket } from './OrderSheet';
import VoicePanel, { useBrowserSpeech } from './VoicePanel';
import ScenarioPanel from './ScenarioPanel';
import useBroker from './useBroker';
import BrokerOrderSheet, { brokerStatusLabels } from './BrokerOrderSheet';
import { quoteSummary } from './brokerClient';
import { useCcp } from './useCcp';
import CcpControls from './CcpControls';
import './ccp.css';
import WatchView from './WatchView';
import BriefView from './BriefView';

const tabs = [{ id: 'watch', label: '관심종목', icon: Star }, { id: 'brief', label: '브리핑', icon: AudioLines }, { id: 'orders', label: '주문내역', icon: ReceiptText }] as const;
export default function App() {
  const [tab, setTab] = useState<'watch' | 'brief' | 'orders'>('watch');
  const [selectedStock, setStock] = useState(stocks[0]);
  const broker = useBroker();
  const demo = broker.status?.provider === 'demo';
  const paperReady = !!broker.status?.configured && !demo;
  const quoteData = paperReady ? broker.quotes.value ?? [] : [];
  const displayStocks = demo ? stocks : stocks.map(item => {
    const quote = quoteData.find(quote => quote.symbol === item.symbol);
    return { ...item, price: quote?.price ?? NaN, change: quote?.change ?? NaN, percent: quote?.percent ?? NaN, series: [], held: 0, summary: quoteSummary(quote) };
  });
  const stock = displayStocks.find(item => item.symbol === selectedStock.symbol)!;
  const shownOrders = demo ? null : broker.orders.value ?? [];
  const money = (value: number | null | undefined) => value != null && Number.isFinite(value) ? won(value) : '-';
  const briefing = demo ? marketBrief : quoteData.length ? `${broker.quotes.error || broker.connectionError ? '이전 조회 시세입니다.' : '조회 시세 요약입니다.'} ${quoteData.map(quote => quoteSummary(quote)).join(' ')}` : '조회한 시세가 없습니다. 연결 상태를 확인해 주세요.';
  const providerLabel = broker.status?.provider === 'kis' ? '한국투자증권' : '키움증권';
  const stale = !!(broker.connectionError || broker.quotes.error || broker.account.error || broker.orders.error || (broker.quotes.receivedAt && Date.now() - broker.quotes.receivedAt > 90000));
  const statusText = broker.connectionError ? '연결 실패' : !broker.status ? '연결 확인 중' : demo ? '데모' : !broker.status.configured ? `${providerLabel} · 설정 필요` : `${providerLabel} 모의투자${stale ? ' · 갱신 필요' : ''}`;
  const statusDetail = broker.connectionError || broker.quotes.error || broker.account.error || broker.orders.error || broker.status?.missing.join(', ') || undefined;
  const [period, setPeriod] = useState('1일');
  const [dark, setDark] = useState(false);
  const [split, setSplit] = useState(false);
  const [showCcp, setShowCcp] = useState(false);
  const [vehicle, setVehicle] = useState<VehicleState>(vehicleScenarios.parked);
  const [settings, setSettings] = useState(false);
  const [voice, setVoice] = useState(false);
  const [empty, setEmpty] = useState(false);
  const [ticket, setTicket] = useState<OrderTicket | null>(null);
  const [toast, setToast] = useState('');
  const [alertSymbols, setAlertSymbols] = useState<string[]>([]);
  const [trading, dispatch] = useTrading();
  const speech = useBrowserSpeech();
  const compact = vehicle.requiresDistractionOptimization === true;
  const missingSignals = [vehicle.gear === 'unknown' && '기어', vehicle.speedMps === null && '속도', (vehicle.restrictions === null || vehicle.requiresDistractionOptimization === null) && '화면 제한'].filter(Boolean);
  const keyboardRestricted = !!((vehicle.restrictions ?? 0) & UXR.NO_KEYBOARD);
  const demoBalance = getBalances(trading.orders, stock.symbol);
  const account = paperReady ? broker.account.value : null;
  const position = account?.positions.find(item => item.symbol === stock.symbol);
  const balance = demo ? demoBalance : { held: account ? position?.quantity ?? 0 : NaN, availableCash: account?.availableCash ?? NaN };
  const orderCount = demo ? trading.orders.length : shownOrders?.length ?? 0;
  const quoteFresh = broker.quotes.receivedAt !== null && Date.now() - broker.quotes.receivedAt <= 90000;
  const orderReady = paperReady && !broker.checkingSession && !broker.connectionError && !broker.quotes.error && !broker.account.error && quoteFresh && !!account && Number.isFinite(stock.price);
  const asOf = demo ? '15:30 기준' : tab === 'orders' ? account?.asOf : quoteData.find(item => item.symbol === stock.symbol)?.asOf;
  const snapshotLabel = demo ? asOf : asOf ? `${new Date(asOf).toLocaleString('ko-KR')} 응답${stale ? ' · 이전 시세' : ''}` : '시세 미조회';
  const openOrder = (side: 'buy' | 'sell', target = stock, quantity = 1) => { speech.stop(); broker.clearOrderError(); setTicket({ id: crypto.randomUUID(), stock: target, side, quantity }); };
  const selectStock = (next: Stock) => { speech.stop(); setStock(next); setPeriod('1일'); };
  const orderStock = (symbol: string, price: number): Stock => ({ ...(displayStocks.find(item => item.symbol === symbol) ?? { symbol, name: account?.positions.find(item => item.symbol === symbol)?.name || symbol, short: symbol.slice(-2), color: '#214b6b', change: NaN, percent: NaN, series: [], held: 0, summary: '' }), price });
  useEffect(() => { setTicket(null); }, [broker.status?.session, broker.status?.provider, broker.status?.configured]);
  useEffect(() => { document.documentElement.dataset.theme = dark ? 'dark' : 'light'; }, [dark]);
  useEffect(() => { if (!toast) return; const timer = window.setTimeout(() => setToast(''), 3500); return () => clearTimeout(timer); }, [toast]);
  const setView = (next: typeof tab) => { speech.stop(); setTab(next); };
  const executeCommand = (command: 'quote' | 'brief' | 'buy') => {
    setVoice(false);
    if (command === 'quote') { selectStock(displayStocks[0]); setTab('watch'); speech.speak(displayStocks[0].summary); }
    if (command === 'brief') { setTab('brief'); speech.speak(briefing); }
    if (command === 'buy') { selectStock(displayStocks[2]); setTab('watch'); openOrder('buy', displayStocks[2], 2); }
  };
  const ccp = useCcp({ onBack: () => {
    speech.stop();
    if (tab !== 'watch') { setTab('watch'); return; }
    const host = (window as Window & { PleosNative?: { hideApp: () => void } }).PleosNative;
    if (host) host.hideApp();
    else setToast('현재 첫 화면입니다.');
  } });
  useEffect(() => { document.querySelector<HTMLElement>('[data-ccp-root]')?.focus({ preventScroll: true }); }, []);
  return <div className="prototype-page" data-ccp-root data-ccp-mode={ccp.mode} tabIndex={-1}>
    <div className="review-bar" data-ccp-ignore><div><span className="review-mark">주식</span></div><div className="review-controls">
      <span className="demo-badge" role="status" title={statusDetail}><span/> {statusText}</span>
      <button aria-label="물리 버튼" aria-expanded={showCcp} onClick={() => { setShowCcp(!showCcp); if (!showCcp) ccp.dispatch('next'); }}><CircleDot size={18}/><span>물리 버튼</span></button>
      <button disabled={broker.refreshing} onClick={() => void broker.refresh()}>{broker.refreshing ? '조회 중' : '새로고침'}</button>
      <button title="화면 크기 변경" aria-label={split ? '전체 앱 화면' : '분할 앱 화면'} onClick={() => setSplit(!split)}>{split ? <Maximize2 size={18}/> : <Minimize2 size={18}/>}<span>{split ? '전체 화면' : '분할 화면'}</span></button>
      <button aria-label="데모 설정" onClick={() => setSettings(true)}><SlidersHorizontal size={18}/><span>설정</span></button>
    </div></div>
    {showCcp && <CcpControls controller={ccp}/> }
    <div className={`device ${split ? 'split-device' : ''}`}>
      <div className="system-bar" data-ccp-ignore><div className="vehicle-status"><span className="gear">{vehicle.gear === 'unknown' ? '?' : vehicle.gear}</span><span>{vehicle.speedMps === null ? '속도 미수신' : `${Math.round(vehicle.speedMps * 3.6)} km/h`}</span><span className="system-divider"/><span>{vehicle.requiresDistractionOptimization === null ? '화면 제한 미수신' : compact ? '간소화 보기' : '기본 보기'}</span></div><div className="system-right"><span>16:20</span><Wifi size={19}/><button aria-label={dark ? '주간 모드' : '야간 모드'} onClick={() => setDark(!dark)}>{dark ? <Sun size={21}/> : <Moon size={21}/>}</button></div></div>
      <div className={`app-window ${compact ? 'compact' : ''}`}>
        <nav data-ccp-area="주 메뉴" className="app-dock" aria-label="주 메뉴">
          <div className="nav-items">{tabs.map(({ id, label, icon: Icon }) => <button key={id} aria-label={label} className={tab === id ? 'active' : ''} aria-current={tab === id ? 'page' : undefined} onClick={() => setView(id)}><Icon size={23}/><span>{label}</span>{id === 'orders' && orderCount > 0 && <i>{orderCount}</i>}</button>)}</div>
          <div className="nav-bottom"><button aria-label="빠른 실행" onClick={() => setVoice(true)}><Zap size={23}/><span>빠른 실행</span></button></div>
        </nav>
        <main key={`${tab}-${compact}`} className={tab === 'watch' ? 'watch-page' : 'content-page'} data-ccp-area="본문">
          {tab !== 'watch' && <header className="page-heading"><h1>{tabs.find(item => item.id === tab)?.label}</h1><span className="snapshot-label"><Clock3 size={16}/> {snapshotLabel}</span></header>}
          {missingSignals.length > 0 && <div className="info-notice"><CircleHelp size={19}/> {missingSignals.join('·')} 미수신</div>}
          {tab === 'watch' && <WatchView stock={stock} displayStocks={displayStocks} demo={demo} compact={compact} empty={empty} period={period} held={balance.held} orderReady={orderReady} snapshotLabel={snapshotLabel || ''} stale={stale} alertEnabled={alertSymbols.includes(stock.symbol)} speechState={speech.state}
            onStockSelect={selectStock} onPeriodChange={setPeriod} onRestoreWatchlist={() => setEmpty(false)}
            onToggleAlert={() => { const enabled = alertSymbols.includes(stock.symbol); setAlertSymbols(enabled ? alertSymbols.filter(symbol => symbol !== stock.symbol) : [...alertSymbols, stock.symbol]); setToast(`${stock.name} 알림 ${enabled ? '끔' : '켬'}`); }}
            onOpenOrder={side => openOrder(side)} onPlayBrief={() => speech.speak(stock.summary)} onStopBrief={speech.stop} onMarketBrief={() => setView('brief')}/>}
          {tab === 'brief' && <BriefView stock={stock} demo={demo} stale={stale} briefing={briefing} speech={speech}/>}
          {tab === 'orders' && <section className="orders-page"><div className="account-summary"><span>모의 계좌</span><span>주문 가능 <strong>{money(balance.availableCash)}원</strong></span></div>{!demo ? <>{broker.orders.value === null ? <div className="empty-state"><ReceiptText size={42}/><h2>주문내역 조회 실패</h2><p>연결 확인 후 새로고침해 주세요.</p></div> : shownOrders?.length === 0 ? <div className="empty-state"><ReceiptText size={42}/><h2>주문내역이 없습니다</h2></div> : <div className="order-list">{shownOrders?.map(order => <button className="order-row" key={order.id} onClick={() => setTicket({ id: order.id, stock: orderStock(order.symbol, order.price), side: order.side, quantity: order.quantity })}><div className={`order-direction ${order.side}`}><ReceiptText size={24}/></div><div><strong>{stocks.find(item => item.symbol === order.symbol)?.name ?? order.symbol}</strong><p>모의 {order.side === 'buy' ? '매수' : '매도'} {order.quantity}주 · {money(order.price)}원 · 체결 {order.status === 'unknown' ? '-' : order.filledQuantity}주</p></div><span className={`order-status ${order.status}`}>{brokerStatusLabels[order.status]}</span><ChevronRight size={20}/></button>)}</div>}</> : trading.orders.length === 0 ? <div className="empty-state"><ReceiptText size={42}/><h2>주문내역이 없습니다</h2><button className="primary" onClick={() => setView('watch')}>관심종목 보기</button></div> : <div className="order-list">{trading.orders.map(order => <button className="order-row" key={order.id} onClick={() => setTicket({ id: order.id, stock: stocks.find(item => item.symbol === order.symbol)!, side: order.side, quantity: order.quantity })}><div className={`order-direction ${order.side}`}><ReceiptText size={24}/></div><div><strong>{stocks.find(item => item.symbol === order.symbol)?.name}</strong><p>{order.side === 'buy' ? '매수' : '매도'} {order.quantity}주 · {won(order.price)}원</p></div><span className={`order-status ${order.status}`}>{statusLabels[order.status]}</span><ChevronRight size={20}/></button>)}</div>}</section>}
        </main>

      </div>
    </div>
    {toast && <div className="toast" data-ccp-ignore role="status">{toast}<button aria-label="알림 닫기" onClick={() => setToast('')}><X size={17}/></button></div>}
    {ticket && !demo && <BrokerOrderSheet key={ticket.id} ticket={ticket} orders={shownOrders ?? []} account={account} ready={orderReady} cancelReady={paperReady && !broker.checkingSession && !broker.connectionError} pending={broker.pending} error={broker.orderError} buyingPower={broker.buyingPower} onPlace={broker.place} onCancel={broker.cancel} onRefresh={broker.refresh} onClose={() => setTicket(null)} keyboardRestricted={keyboardRestricted}/>}
    {ticket && demo && <OrderSheet key={ticket.id} ticket={ticket} orders={trading.orders} error={trading.error} onPlace={order => dispatch({ type: 'place', order })} onEvent={(id, event) => dispatch({ type: 'transition', id, event })} onClose={() => setTicket(null)} keyboardRestricted={keyboardRestricted}/>}
    {voice && <VoicePanel onClose={() => setVoice(false)} onCommand={executeCommand}/>}
    {settings && <ScenarioPanel vehicle={vehicle} onVehicle={setVehicle} empty={empty} onEmpty={setEmpty} onClose={() => setSettings(false)}/>}
  </div>;
}

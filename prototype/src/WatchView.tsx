import { lazy, Suspense } from 'react';
import { ArrowDownRight, ArrowUpRight, Bell, Check, ChevronRight, Clock3, Minus, Plus, Star, Volume2 } from 'lucide-react';
import type { Stock } from './market';
import { signed, won } from './market';
import { SpeechButton } from './VoicePanel';
import type { useBrowserSpeech } from './VoicePanel';
import './watch-view.css';

const StockChart = lazy(() => import('./StockChart'));

export interface WatchViewProps {
  stock: Stock;
  displayStocks: Stock[];
  demo: boolean;
  compact: boolean;
  empty: boolean;
  period: string;
  held: number;
  orderReady: boolean;
  snapshotLabel: string;
  stale: boolean;
  alertEnabled: boolean;
  speechState: ReturnType<typeof useBrowserSpeech>['state'];
  onStockSelect: (stock: Stock) => void;
  onPeriodChange: (period: string) => void;
  onRestoreWatchlist: () => void;
  onToggleAlert: () => void;
  onOpenOrder: (side: 'buy' | 'sell') => void;
  onPlayBrief: () => void;
  onStopBrief: () => void;
  onMarketBrief: () => void;
}

const money = (value: number) => Number.isFinite(value) ? won(value) : '-';
const percent = (value: number) => Number.isFinite(value) ? signed(value) : '-';
const directionClass = (value: number) => !Number.isFinite(value) || value === 0 ? 'watch-flat' : value > 0 ? 'rise' : 'fall';

function Direction({ value, size = 20 }: { value: number; size?: number }) {
  if (!Number.isFinite(value)) return null;
  return value > 0 ? <ArrowUpRight size={size} aria-hidden="true"/> : value < 0 ? <ArrowDownRight size={size} aria-hidden="true"/> : <Minus size={size} aria-hidden="true"/>;
}

export default function WatchView({ stock, displayStocks, demo, compact, empty, period, held, orderReady, snapshotLabel, stale, alertEnabled, speechState, onStockSelect, onPeriodChange, onRestoreWatchlist, onToggleAlert, onOpenOrder, onPlayBrief, onStopBrief, onMarketBrief }: WatchViewProps) {
  return <div className={`watch-view${compact ? ' watch-view-compact' : ''}`}>
    {empty ? <section className="watch-empty"><Star size={36}/><h1>관심종목이 없습니다</h1><button className="primary" onClick={onRestoreWatchlist}><Plus size={22}/>관심종목 추가</button></section> : <div className="watch-content">
      <section data-ccp-area="선택 종목" className="watch-focus-card" aria-label="선택 종목 상세">
        <div className="watch-stock-heading"><div><h1>{stock.name}</h1><span className="watch-symbol">{stock.symbol} · KOSPI</span></div><button className={`watch-alert${alertEnabled ? ' is-enabled' : ''}`} aria-label={`${stock.name} 알림 ${alertEnabled ? '해제' : '설정'}`} aria-pressed={alertEnabled} onClick={onToggleAlert}><Bell size={24}/></button></div>
        <div className="watch-price-block"><div className="watch-main-price">{money(stock.price)}<span>원</span></div><div className={`watch-main-change ${directionClass(stock.change)}`}><Direction value={stock.change} size={25}/><span>{Number.isFinite(stock.change) ? `${stock.change > 0 ? '+' : stock.change < 0 ? '−' : ''}${money(Math.abs(stock.change))}` : '-'}원 <span className="watch-percent">({percent(stock.percent)})</span></span><span className="watch-change-label">전일 대비</span></div><div className={`watch-asof${stale ? ' is-stale' : ''}`}><Clock3 size={14}/><span>{snapshotLabel}</span></div></div>
        <div className="watch-analysis-space">
          {!compact && (demo ? <><div className="watch-chart"><Suspense fallback={<div className="stock-chart"/>}><StockChart stock={stock} period={period} compact={false}/></Suspense></div><div className="watch-periods" aria-label="차트 기간">{['1일', '1주', '1개월'].map(value => <button key={value} className={period === value ? 'is-selected' : ''} aria-pressed={period === value} onClick={() => onPeriodChange(value)}>{value}</button>)}</div></> : <span className="watch-no-chart">차트 없음</span>)}
        </div>
        <div className="watch-card-bottom"><div className="watch-holding"><span>보유</span><span><strong>{money(held)}주</strong><span className="watch-holding-value">{money(held * stock.price)}원</span></span></div><div className="watch-stock-brief"><SpeechButton state={speechState} onPlay={onPlayBrief} onStop={onStopBrief}/></div><div className="watch-trade-actions" data-ccp-area="매수·매도" data-ccp-right="selected-stock"><button className="watch-buy" data-ccp-target="order-buy" disabled={!demo && !orderReady} onClick={() => onOpenOrder('buy')}>{demo ? '매수' : '모의 매수'}<Plus size={22}/></button><button className="watch-sell" disabled={!demo && !orderReady} onClick={() => onOpenOrder('sell')}>{demo ? '매도' : '모의 매도'}<Minus size={22}/></button></div></div>
      </section>
      <aside data-ccp-area="관심종목" data-ccp-left="order-buy" className="watch-side" aria-label="관심종목 목록"><div className="watch-list-heading"><h2>관심종목</h2><span>{displayStocks.length}</span></div><div className="watch-stocks">{displayStocks.map(item => <button className={`watch-stock-row${item.symbol === stock.symbol ? ' is-selected' : ''}`} key={item.symbol} data-ccp-default={item.symbol === stock.symbol || undefined} data-ccp-target={item.symbol === stock.symbol ? 'selected-stock' : undefined} data-ccp-label={item.name} aria-pressed={item.symbol === stock.symbol} onClick={() => onStockSelect(item)}><span className="watch-row-selection" aria-hidden="true">{item.symbol === stock.symbol && <Check size={17}/>}</span><span className="watch-row-name">{item.name}<small>{item.symbol}</small></span><span className="watch-row-price">{money(item.price)}<small className={directionClass(item.change)}><Direction value={item.change} size={17}/>{percent(item.percent)}</small></span></button>)}</div><button className="watch-market-brief" onClick={onMarketBrief}><Volume2 size={22}/><span>시장 브리핑</span><ChevronRight size={20}/></button></aside>
    </div>}
    {demo && <footer className="watch-market-footer" aria-label="시장지수"><span>KOSPI <strong>2,534.66</strong><span className="rise"><ArrowUpRight size={14}/>+0.72%</span></span><span>KOSDAQ <strong>736.10</strong><span className="fall"><ArrowDownRight size={14}/>−0.31%</span></span></footer>}
  </div>;
}

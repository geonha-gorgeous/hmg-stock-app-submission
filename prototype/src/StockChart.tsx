import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { Stock } from './market';
import { won } from './market';

export default function StockChart({ stock, period, compact }: { stock: Stock; period: string; compact: boolean }) {
  const factor = period === '1주' ? 3 : period === '1개월' ? 7 : 1;
  const data = stock.series.map((price, index) => ({ time: period === '1일' ? ['09:00', '', '', '', '', '', '', '12:00', '', '', '', '', '', '', '15:30'][index] : `${index + 1}`, price: stock.price + (price - stock.price) * factor }));
  const color = stock.change > 0 ? 'var(--rise)' : 'var(--fall)';
  return <div className={`stock-chart ${compact ? 'compact-chart' : ''}`} role="img" aria-label={`${stock.name} ${period} 가격 차트`}>
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 8, right: 24, bottom: 0, left: 24 }}>
        <defs><linearGradient id="chart-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity={0.14}/><stop offset="95%" stopColor={color} stopOpacity={0}/></linearGradient></defs>
        <CartesianGrid vertical={false} stroke="var(--line)" strokeDasharray="3 5"/>
        <XAxis dataKey="time" axisLine={false} tickLine={false} interval={0} tick={{ fill: 'var(--muted)', fontSize: 13 }} minTickGap={20}/>
        <YAxis hide domain={['dataMin - 300', 'dataMax + 400']}/>
        {!compact && <Tooltip formatter={value => `${won(Number(value))}원`} labelFormatter={() => '시세'} contentStyle={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 12, color: 'var(--text)' }}/ >}
        <Area type="linear" dataKey="price" stroke={color} strokeWidth={2.5} fill="url(#chart-fill)" isAnimationActive={false}/>
      </AreaChart>
    </ResponsiveContainer>
  </div>;
}

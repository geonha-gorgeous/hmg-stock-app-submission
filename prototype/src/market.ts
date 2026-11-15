export interface Stock {
  symbol: string; name: string; short: string; price: number; change: number;
  percent: number; color: string; series: number[]; held: number; summary: string;
}

/** Hand-authored, fixed fixtures. These values are not live prices or news. */
export const stocks: Stock[] = [
  { symbol: '005930', name: '삼성전자', short: '삼성', price: 70500, change: 900, percent: 1.29, color: '#2854b4', held: 10,
    series: [69200,69450,69180,69600,69520,69760,69680,70100,69900,70030,70320,70250,70420,70350,70500],
    summary: '삼성전자 현재가는 70,500원으로, 전일 대비 1.29퍼센트 상승했습니다. 보유 수량은 10주입니다.' },
  { symbol: '000660', name: 'SK하이닉스', short: 'SK', price: 189500, change: 4500, percent: 2.43, color: '#ab352a', held: 4,
    series: [185000,184500,186000,185500,186400,187800,187100,188000,187400,188200,188000,189000,188400,189800,189500],
    summary: 'SK하이닉스 현재가는 189,500원으로, 전일 대비 2.43퍼센트 상승했습니다. 보유 수량은 4주입니다.' },
  { symbol: '005380', name: '현대차', short: '현대', price: 245000, change: -2000, percent: -0.81, color: '#214b6b', held: 3,
    series: [247000,247400,246500,246800,245900,246200,245600,246000,245200,245500,245000,245600,245200,244800,245000],
    summary: '현대차 현재가는 245,000원으로, 전일 대비 0.81퍼센트 하락했습니다. 보유 수량은 3주입니다.' },
  { symbol: '035420', name: 'NAVER', short: 'N', price: 182000, change: 1000, percent: 0.55, color: '#207342', held: 0,
    series: [181000,180500,181200,181500,181000,181600,181300,182000,181600,181800,182200,181800,182100,181900,182000],
    summary: '네이버 현재가는 182,000원으로, 전일 대비 0.55퍼센트 상승했습니다. 보유한 수량은 없습니다.' },
];
export const won = (value: number) => new Intl.NumberFormat('ko-KR').format(value);
export const signed = (value: number) => `${value > 0 ? '+' : ''}${value.toFixed(2)}%`;
export const marketBrief = '코스피는 0.72퍼센트 상승, 코스닥은 0.31퍼센트 하락했습니다. 관심 종목 네 개 중 세 개가 상승했습니다.';

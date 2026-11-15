import { useState } from 'react';
import { ArrowDownRight, ArrowUpRight, AudioLines, Volume2 } from 'lucide-react';
import { SpeechButton, type useBrowserSpeech } from './VoicePanel';
import type { Stock } from './market';

interface Props {
  stock: Stock;
  demo: boolean;
  stale: boolean;
  briefing: string;
  speech: ReturnType<typeof useBrowserSpeech>;
}

/** Keeps playback, its content, and the selected-stock action in stable slots. */
export default function BriefView({ stock, demo, stale, briefing, speech }: Props) {
  const [playingLabel, setPlayingLabel] = useState('시장·관심종목');
  const playing = speech.state === 'starting' || speech.state === 'speaking';
  const status = speech.state === 'starting' ? '준비 중' : speech.state === 'speaking' ? '재생 중' : speech.state === 'error' ? '재생할 수 없습니다' : speech.state === 'done' ? '재생 완료' : '';
  return <section className="drive-brief" aria-label="시세 브리핑">
    <div className={`brief-player ${playing ? 'is-playing' : ''}`}>
      <div className="brief-player-heading"><AudioLines size={32}/><span>시장·관심종목</span></div>
      <h2>{demo ? <>4개 종목 중<br/>3개 상승</> : '관심종목 시세'}</h2>
      <div className="brief-playback-state" role="status">{status ? `${playingLabel} · ${status}` : !demo && stale ? '이전 시세' : ''}</div>
      <SpeechButton state={speech.state} onPlay={() => { setPlayingLabel('시장·관심종목'); speech.speak(briefing); }} onStop={speech.stop}/>
    </div>
    <div className="brief-context">
      {demo ? <div className="brief-market-values">
        <div><span>KOSPI</span><strong className="rise"><ArrowUpRight/>+0.72%</strong></div>
        <div><span>KOSDAQ</span><strong className="fall"><ArrowDownRight/>−0.31%</strong></div>
      </div> : <p className="broker-brief-copy">{briefing}</p>}
      <button className="brief-selected-stock" onClick={() => { setPlayingLabel(stock.name); speech.speak(stock.summary); }}>
        <Volume2 size={28}/><span><small>선택 종목</small><strong>{stock.name} 듣기</strong></span>
      </button>
    </div>
  </section>;
}

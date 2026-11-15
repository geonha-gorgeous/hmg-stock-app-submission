import { ArrowUpRight, Check, Play, Square } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import Modal from './Modal';

export function useBrowserSpeech() {
  const [state, setState] = useState<'idle' | 'starting' | 'speaking' | 'done' | 'error'>('idle');
  const session = useRef(0);
  const stop = () => { session.current++; window.speechSynthesis?.cancel(); setState('idle'); };
  const speak = (text: string) => {
    stop();
    if (!('speechSynthesis' in window)) { setState('error'); return; }
    const id = ++session.current;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'ko-KR'; utterance.rate = 1;
    utterance.onstart = () => { if (session.current === id) setState('speaking'); };
    utterance.onend = () => { if (session.current === id) setState('done'); };
    utterance.onerror = () => { if (session.current === id) setState('error'); };
    setState('starting'); window.speechSynthesis.speak(utterance);
  };
  useEffect(() => () => { session.current++; window.speechSynthesis?.cancel(); }, []);
  return { state, speak, stop };
}
export default function VoicePanel({ onClose, onCommand }: { onClose: () => void; onCommand: (command: 'quote' | 'brief' | 'buy') => void }) {
  return <Modal title="빠른 실행" onClose={onClose} className="voice-modal">
    <div className="voice-examples">{([
      ['quote', '삼성전자 시세'], ['brief', '시장 브리핑'], ['buy', '현대차 2주 매수'],
    ] as const).map(([command, text]) => <button key={command} onClick={() => onCommand(command)}><span>{text}</span><ArrowUpRight size={21}/></button>)}</div>
  </Modal>;
}
export function SpeechButton({ state, onPlay, onStop }: { state: ReturnType<typeof useBrowserSpeech>['state']; onPlay: () => void; onStop: () => void }) {
  return <button className="primary listen-button" onClick={state === 'speaking' || state === 'starting' ? onStop : onPlay}>
    {state === 'speaking' || state === 'starting' ? <Square size={20}/> : state === 'done' ? <Check size={20}/> : <Play size={20} fill="currentColor"/>}
    {state === 'starting' ? '취소' : state === 'speaking' ? '브리핑 중지' : state === 'done' ? '다시 듣기' : state === 'error' ? '다시 듣기' : '브리핑 듣기'}
  </button>;
}

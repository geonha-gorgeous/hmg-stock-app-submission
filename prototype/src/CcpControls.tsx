import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, CornerUpLeft, RotateCcw, RotateCw } from 'lucide-react';
import type { CcpAction, CcpState } from './ccp';

interface Props { controller: CcpState & { dispatch: (action: CcpAction) => void } }
export default function CcpControls({ controller }: Props) {
  const { dispatch, mode, label, area, target } = controller;
  const navigationHelp = area === '관심종목' ? '← 매수 · Enter 선택 · Esc 뒤로' : area === '매수·매도' && target?.closest('[data-ccp-right="selected-stock"]') ? '→ 종목 · Enter 선택 · Esc 뒤로' : '방향키 이동 · Enter 선택 · Esc 뒤로';
  const button = (action: CcpAction, name: string, icon: React.ReactNode) => <button type="button" aria-label={name} onPointerDown={event => event.preventDefault()} onClick={() => dispatch(action)}>{icon}</button>;
  return <section className="ccp-controls" aria-label="물리 버튼" data-ccp-ignore>
    <div className="ccp-readout"><span>물리 버튼</span><strong>{label || '항목 선택'}</strong><small>{mode === 'editing' ? '수량 편집 · 회전 조절 · 뒤로 완료' : `${area ? `${area} · ` : ''}${navigationHelp}`}</small></div>
    <div className="ccp-rotary">{button('previous', '반시계 방향 회전', <><RotateCcw size={20}/><span>이전</span></>)}{button('next', '시계 방향 회전', <><RotateCw size={20}/><span>다음</span></>)}</div>
    <div className="ccp-direction">{button('left', '왼쪽 이동', <ArrowLeft size={20}/>)}{button('up', '위로 이동', <ArrowUp size={20}/>)}{button('down', '아래로 이동', <ArrowDown size={20}/>)}{button('right', '오른쪽 이동', <ArrowRight size={20}/>)}</div>
    <button type="button" className="ccp-select" onPointerDown={event => event.preventDefault()} onClick={() => dispatch('select')}>선택</button>
    <button type="button" onPointerDown={event => event.preventDefault()} onClick={() => dispatch('back')}><CornerUpLeft size={20}/><span>뒤로</span></button>
  </section>;
}

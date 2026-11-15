export default function OrderQuantityHelp({ keyboardRestricted }: { keyboardRestricted: boolean }) {
  return <p className="order-input-help" role="status">
    {keyboardRestricted && <span className="order-touch-help">− / +로 조절</span>}
    <span className="order-ccp-navigation">선택 / Enter로 수량 조절</span>
    <span className="order-ccp-editing">회전: 수량 변경 · 선택 / 뒤로: 완료</span>
  </p>;
}

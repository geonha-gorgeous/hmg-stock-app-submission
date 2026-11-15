import { RotateCcw } from 'lucide-react';
import Modal from './Modal';
import { UXR, vehicleScenarios } from './domain';
import type { VehicleState } from './domain';

export default function ScenarioPanel({ vehicle, onVehicle, empty, onEmpty, onClose }: { vehicle: VehicleState; onVehicle: (state: VehicleState) => void; empty: boolean; onEmpty: (empty: boolean) => void; onClose: () => void }) {
  return <Modal title="데모 설정" onClose={onClose} className="scenario-modal">
    <h3>차량 상태</h3><div className="scenario-buttons">{(['parked', 'driving', 'idling', 'unknown'] as const).map((key, i) => <button className="secondary" key={key} onClick={() => onVehicle(vehicleScenarios[key])}>{['P · 주차', 'D · 50 km/h', 'D · 0 km/h', '미수신'][i]}</button>)}</div>
    <label className="toggle-row"><span>간소화 보기</span><input type="checkbox" checked={vehicle.requiresDistractionOptimization === true} onChange={event => onVehicle({ ...vehicle, requiresDistractionOptimization: event.target.checked })}/></label>
    <label className="toggle-row"><span>{vehicle.restrictions === null ? '키보드 제한 미수신' : '키보드 제한'}</span><input type="checkbox" disabled={vehicle.restrictions === null} checked={vehicle.restrictions !== null && !!(vehicle.restrictions & UXR.NO_KEYBOARD)} onChange={event => { if (vehicle.restrictions !== null) onVehicle({ ...vehicle, restrictions: event.target.checked ? vehicle.restrictions | UXR.NO_KEYBOARD : vehicle.restrictions & ~UXR.NO_KEYBOARD }); }}/></label>
    <label className="toggle-row"><span>관심종목 비우기</span><input type="checkbox" checked={empty} onChange={event => onEmpty(event.target.checked)}/></label>
    <button className="secondary full" onClick={() => { onVehicle(vehicleScenarios.parked); onEmpty(false); }}><RotateCcw size={18}/> 초기화</button>
  </Modal>;
}

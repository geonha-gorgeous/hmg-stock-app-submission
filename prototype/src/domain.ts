/** Fixture-only vehicle data. This module does not connect to a vehicle SDK. */
export type Gear = 'P' | 'D' | 'R' | 'N' | 'unknown';

export interface VehicleState {
  gear: Gear;
  speedMps: number | null;
  requiresDistractionOptimization: boolean | null;
  restrictions: number | null;
  source: 'fixture';
}

/** Android CarUxRestrictions bit values, not inferred from gear or speed. */
export const UXR = {
  BASELINE: 0,
  NO_DIALPAD: 1,
  NO_FILTERING: 2,
  LIMIT_STRING_LENGTH: 4,
  NO_KEYBOARD: 8,
  NO_VIDEO: 16,
  LIMIT_CONTENT: 32,
  NO_SETUP: 64,
  NO_TEXT_MESSAGE: 128,
  NO_VOICE_TRANSCRIPTION: 256,
  FULLY_RESTRICTED: 511,
} as const;

/** Example values only: vehicle UX restrictions depend on platform and market. */
export const vehicleScenarios: Record<'parked' | 'driving' | 'idling' | 'unknown', VehicleState> = {
  parked: { gear: 'P', speedMps: 0, requiresDistractionOptimization: false, restrictions: UXR.BASELINE, source: 'fixture' },
  driving: { gear: 'D', speedMps: 13.9, requiresDistractionOptimization: true, restrictions: UXR.FULLY_RESTRICTED, source: 'fixture' },
  idling: { gear: 'D', speedMps: 0, requiresDistractionOptimization: true, restrictions: UXR.FULLY_RESTRICTED, source: 'fixture' },
  unknown: { gear: 'unknown', speedMps: null, requiresDistractionOptimization: null, restrictions: null, source: 'fixture' },
};

/** Shows raw gear and signed speed separately; does not decide order eligibility. */
export function deriveVehicleLabel(state: VehicleState): string {
  const gear = state.gear === 'unknown' ? '기어 확인 불가' : `기어 ${state.gear}`;
  const speed = state.speedMps === null || !Number.isFinite(state.speedMps)
    ? '속도 확인 불가'
    : `속도 ${state.speedMps} m/s`;
  return `${gear} · ${speed}`;
}

export interface DemoOrder {
  id: string;
  symbol: string;
  side: 'buy' | 'sell';
  quantity: number;
  price: number;
  status: 'accepted' | 'filled' | 'cancelled' | 'rejected';
  reason?: string;
}

export interface OrderValidationInput {
  quantity: number;
  price: number;
  side: DemoOrder['side'];
  availableCash: number;
  availableQuantity: number;
}

/** Validates demo inputs only; returns a reason, or null when valid. */
export function validateOrder(input: OrderValidationInput): string | null {
  const { quantity, price, side, availableCash, availableQuantity } = input;
  if (!Number.isFinite(quantity) || quantity <= 0) return '수량을 올바르게 입력해 주세요.';
  if (!Number.isFinite(price) || price <= 0) return '가격을 올바르게 입력해 주세요.';
  if (!Number.isFinite(availableCash) || availableCash < 0 || !Number.isFinite(availableQuantity) || availableQuantity < 0) {
    return '모의 잔고를 확인해 주세요.';
  }
  if (side === 'buy' && (!Number.isFinite(quantity * price) || quantity * price > availableCash)) return '모의 주문 가능 금액이 부족합니다.';
  if (side === 'sell' && quantity > availableQuantity) return '모의 보유 수량이 부족합니다.';
  return null;
}

export type DemoOrderEvent = 'fill' | 'cancel' | 'reject';

/** Accepted is not filled. Terminal orders are immutable under repeated events. */
export function transitionOrder(order: DemoOrder, event: DemoOrderEvent): DemoOrder {
  if (order.status !== 'accepted') return order;
  const status: DemoOrder['status'] = event === 'fill' ? 'filled' : event === 'cancel' ? 'cancelled' : 'rejected';
  return { ...order, status };
}

import { describe, expect, it } from 'vitest';
import { deriveVehicleLabel, transitionOrder, UXR, validateOrder, vehicleScenarios, type DemoOrder } from './domain';

const input = { quantity: 2, price: 100, side: 'buy' as const, availableCash: 200, availableQuantity: 1 };
const accepted: DemoOrder = { id: 'demo-1', symbol: 'TEST', side: 'buy', quantity: 2, price: 100, status: 'accepted' };

describe('vehicle fixtures', () => {
  it('preserves P versus D at zero speed and keeps unknown values unknown', () => {
    expect(deriveVehicleLabel(vehicleScenarios.parked)).toContain('기어 P');
    expect(deriveVehicleLabel(vehicleScenarios.idling)).toContain('기어 D');
    expect(vehicleScenarios.idling.speedMps).toBe(0);
    expect(vehicleScenarios.unknown).toMatchObject({ gear: 'unknown', speedMps: null, restrictions: null, requiresDistractionOptimization: null });
    expect(deriveVehicleLabel(vehicleScenarios.unknown)).toContain('확인 불가');
  });
  it('uses the documented Android restriction bit values', () => {
    expect(UXR.NO_DIALPAD).toBe(1);
    expect(UXR.NO_KEYBOARD).toBe(8);
    expect(UXR.NO_VIDEO).toBe(16);
    expect(UXR.LIMIT_CONTENT).toBe(32);
    expect(UXR.NO_VOICE_TRANSCRIPTION).toBe(256);
  });
});

describe('local demo orders', () => {
  it('accepts valid values and rejects nonpositive and nonfinite values', () => {
    expect(validateOrder(input)).toBeNull();
    for (const value of [0, -1, NaN, Infinity]) {
      expect(validateOrder({ ...input, quantity: value })).not.toBeNull();
      expect(validateOrder({ ...input, price: value })).not.toBeNull();
    }
    expect(validateOrder({ ...input, availableCash: NaN })).not.toBeNull();
    expect(validateOrder({ ...input, availableQuantity: -1 })).not.toBeNull();
  });
  it('rejects insufficient cash, overflow and overselling', () => {
    expect(validateOrder({ ...input, availableCash: 199 })).not.toBeNull();
    expect(validateOrder({ ...input, quantity: Number.MAX_VALUE, price: 2, availableCash: Number.MAX_VALUE })).not.toBeNull();
    expect(validateOrder({ ...input, side: 'sell' })).not.toBeNull();
    expect(validateOrder({ ...input, side: 'sell', availableQuantity: 2 })).toBeNull();
  });
  it('distinguishes acceptance from fill and preserves terminal orders', () => {
    expect(accepted.status).toBe('accepted');
    const filled = transitionOrder(accepted, 'fill');
    expect(filled.status).toBe('filled');
    expect(accepted.status).toBe('accepted');
    for (const event of ['fill', 'cancel', 'reject'] as const) expect(transitionOrder(filled, event)).toBe(filled);
    const cancelled = transitionOrder(accepted, 'cancel');
    expect(transitionOrder(cancelled, 'fill')).toBe(cancelled);
    const rejected = transitionOrder(accepted, 'reject');
    expect(transitionOrder(rejected, 'fill')).toBe(rejected);
  });
});

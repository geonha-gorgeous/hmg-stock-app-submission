import { describe, expect, it } from 'vitest';
import { getDirectionalTarget, getSequentialTarget, isCcpAction } from './ccp';

function target(left: number, top: number, area: object | null = null): HTMLElement {
  return { getBoundingClientRect: () => ({ left, top, width: 50, height: 50, right: left + 50, bottom: top + 50 }), closest: () => area } as unknown as HTMLElement;
}

describe('CCP navigation order', () => {
  it('wraps in document order and handles empty and stale targets', () => {
    const a = target(0, 0); const b = target(0, 100); const removed = target(0, 200);
    expect(getSequentialTarget([a, b], b, 1)).toBe(a);
    expect(getSequentialTarget([a, b], a, -1)).toBe(b);
    expect(getSequentialTarget([a, b], removed, 1)).toBe(a);
    expect(getSequentialTarget([], a, 1)).toBeNull();
  });
  it('chooses the aligned target in the requested half-plane across areas', () => {
    const areaA = {}; const areaB = {};
    const origin = target(0, 100, areaA);
    const diagonal = target(60, 160, areaA);
    const aligned = target(150, 100, areaB);
    const behind = target(-70, 100, areaA);
    expect(getDirectionalTarget([origin, diagonal, aligned, behind], origin, 'right')).toBe(aligned);
    expect(getDirectionalTarget([origin, diagonal, aligned, behind], origin, 'left')).toBe(behind);
    expect(getDirectionalTarget([origin], origin, 'up')).toBe(origin);
  });
  it('accepts only the bridge action vocabulary', () => {
    expect(isCcpAction('select')).toBe(true);
    expect(isCcpAction('click')).toBe(false);
    expect(isCcpAction(undefined)).toBe(false);
  });
});

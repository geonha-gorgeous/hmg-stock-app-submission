import { describe, expect, it } from 'vitest';
import type { BrokerStatus } from '../shared/broker';
import { BrokerSessionScope } from './brokerSession';

const status: BrokerStatus = { session: 'server-account-a', provider: 'kis', environment: 'paper', configured: true, missing: [] };
describe('broker session isolation', () => {
  it('accepts the first session and preserves pending intent guards for the same session', () => {
    const scope = new BrokerSessionScope();
    expect(scope.accept(status)).toBe(false);
    scope.attempted.add('intent-a');
    expect(scope.accept({ ...status })).toBe(false);
    expect(scope.attempted.has('intent-a')).toBe(true);
    expect(scope.current(0)).toBe(true);
  });
  it('invalidates responses and intent guards on server restart or account replacement', () => {
    const scope = new BrokerSessionScope();
    scope.accept(status);
    const requestVersion = scope.version;
    scope.attempted.add('intent-a');
    expect(scope.accept({ ...status, session: 'server-account-b' })).toBe(true);
    expect(scope.attempted.size).toBe(0);
    expect(scope.current(requestVersion)).toBe(false);
    expect(scope.current(scope.version)).toBe(true);
    // An old mutation result must not enter the replacement account snapshot.
    let accountOrder = null;
    if (scope.current(requestVersion)) accountOrder = 'old-account-order';
    expect(accountOrder).toBeNull();
  });
  it('invalidates the scope if provider or credential configuration changes', () => {
    const scope = new BrokerSessionScope();
    scope.accept(status);
    expect(scope.accept({ ...status, provider: 'kiwoom' })).toBe(true);
    expect(scope.accept({ ...status, provider: 'kiwoom', configured: false, missing: ['KIWOOM_APP_KEY'] })).toBe(true);
    expect(scope.version).toBe(2);
  });
});

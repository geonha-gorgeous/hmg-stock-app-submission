import type { BrokerStatus } from '../shared/broker';

/** A response belongs only to the server/account scope in which its request started. */
export class BrokerSessionScope {
  status: BrokerStatus | null = null;
  version = 0;
  attempted = new Set<string>();
  accept(next: BrokerStatus) {
    const previous = this.status;
    const changed = previous !== null && (previous.session !== next.session || previous.provider !== next.provider || previous.configured !== next.configured);
    if (changed) { this.version += 1; this.attempted.clear(); }
    this.status = next;
    return changed;
  }
  current(version: number) { return version === this.version; }
}

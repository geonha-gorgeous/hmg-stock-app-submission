import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AppOrder, BrokerOrder, OrderInput } from '../shared/broker.ts';

export interface OrderRecord { input: OrderInput; order: AppOrder; broker?: BrokerOrder; cancelRequested?: boolean }

/** Save before dispatch so an interrupted request remains unknown after restart. */
export class OrderJournal {
  records: Map<string, OrderRecord>;
  file: string;
  constructor(directory: string, scope: string) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    this.file = join(directory, `${scope}.json`);
    const stored = existsSync(this.file) ? JSON.parse(readFileSync(this.file, 'utf8')) as { version: number; records: [string, OrderRecord][] } : { version: 1, records: [] };
    if (stored.version !== 1 || !Array.isArray(stored.records)) throw new Error('Order journal is invalid. Preserve it and inspect before restarting.');
    this.records = new Map(stored.records);
    for (const [id, record] of this.records) {
      if (!record || record.order?.id !== id || !record.input || !Number.isSafeInteger(record.input.quantity)) throw new Error('Order journal is invalid.');
    }
  }
  save() {
    const temp = `${this.file}.${process.pid}.tmp`;
    writeFileSync(temp, JSON.stringify({ version: 1, records: [...this.records] }), { mode: 0o600 });
    renameSync(temp, this.file);
  }
}

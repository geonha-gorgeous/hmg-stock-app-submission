import { openSync, closeSync, unlinkSync } from 'node:fs';
import { readConfig } from './config.ts';
import { createTransport } from './transport.ts';
import { OrderJournal } from './journal.ts';
import { BrokerService } from './service.ts';
import { createApiServer } from './http.ts';
import { createKisAdapter } from './providers/kis.ts';
import { createKiwoomAdapter } from './providers/kiwoom.ts';

const config = readConfig();
let service: BrokerService | undefined;
let lock: string | undefined;
if (config.provider !== 'demo' && !config.missing.length) {
  const journal = new OrderJournal(config.dataDirectory, config.accountScope);
  lock = `${journal.file}.lock`;
  try { const fd = openSync(lock, 'wx', 0o600); closeSync(fd); }
  catch { throw new Error('An order journal lock exists. Stop the other broker server before restarting. If it crashed, preserve the journal and remove only its .lock file.'); }
  const adapter = config.provider === 'kis'
    ? createKisAdapter(config.credentials, createTransport('https://openapivts.koreainvestment.com:29443'))
    : createKiwoomAdapter(config.credentials, createTransport('https://mockapi.kiwoom.com'));
  service = new BrokerService(adapter, journal);
}
const server = createApiServer(config, service);
server.listen(config.port, '127.0.0.1', () => {
  console.log(`Donda API http://127.0.0.1:${config.port} (${config.provider}, paper)`);
  if (config.missing.length) console.log(`Missing server configuration: ${config.missing.join(', ')}`);
});
let closed = false;
function cleanup() { if (!closed && lock) { try { unlinkSync(lock); } catch { /* Retain safe startup behavior if cleanup fails. */ } } closed = true; }
server.on('error', error => { console.error('Donda API could not start:', error.message); cleanup(); process.exit(1); });
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => server.close(() => { cleanup(); process.exit(0); }));
process.on('exit', cleanup);

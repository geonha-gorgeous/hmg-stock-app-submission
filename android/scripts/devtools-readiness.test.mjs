import { test } from 'node:test';
import assert from 'node:assert/strict';
import { connectDevtools, waitForAppReady } from './devtools-readiness.mjs';

const page = { url: 'https://appassets.androidplatform.net/index.html', webSocketDebuggerUrl: 'ws://127.0.0.1/devtools/page/1' };
class FakeSocket {
  static instances = [];
  constructor() {
    FakeSocket.instances.push(this);
    queueMicrotask(() => this.onopen?.());
  }
  close() { this.closed = true; }
}
function fixture(overrides = {}) {
  let clock = 0;
  const forwards = [];
  const removed = [];
  const options = {
    timeoutMs: 500, intervalMs: 100,
    now: () => clock, delay: async ms => { clock += ms; },
    adb: (...args) => {
      if (args[0] === 'shell') return '123';
      if (args[1] === '--remove') { removed.push(args[2]); return ''; }
      forwards.push(args[2]);
      return `${24000 + forwards.length}`;
    },
    fetchImpl: async () => ({ ok: true, json: async () => [page] }),
    WebSocketImpl: FakeSocket,
    ...overrides,
  };
  return { options, forwards, removed };
}

test('cold PID absence and UND_ERR_SOCKET are retried; each failed forward is removed', async () => {
  let pidReads = 0;
  let fetches = 0;
  const f = fixture();
  const baseAdb = f.options.adb;
  f.options.adb = (...args) => {
    if (args[0] === 'shell' && ++pidReads === 1) throw Object.assign(new Error('pidof exited 1'), { status: 1 });
    return baseAdb(...args);
  };
  f.options.fetchImpl = async () => {
    if (++fetches === 1) throw new TypeError('fetch failed', { cause: { code: 'UND_ERR_SOCKET' } });
    return { ok: true, json: async () => [page] };
  };
  const session = await connectDevtools(f.options);
  assert.equal(session.pid, '123');
  assert.equal(fetches, 2);
  assert.deepEqual(f.removed, ['tcp:24001']);
  session.cleanup();
  session.cleanup();
  assert.deepEqual(f.removed, ['tcp:24001', 'tcp:24002']);
  assert.equal(session.socket.closed, true);
});

test('PID change reconnects to the new process and closes the stale socket', async () => {
  const f = fixture();
  let reads = 0;
  const baseAdb = f.options.adb;
  f.options.adb = (...args) => args[0] === 'shell' ? (++reads === 1 ? '123' : '456') : baseAdb(...args);
  const firstIndex = FakeSocket.instances.length;
  const session = await connectDevtools(f.options);
  assert.equal(session.pid, '456');
  assert.equal(FakeSocket.instances[firstIndex].closed, true);
  assert.deepEqual(f.forwards, ['localabstract:webview_devtools_remote_123', 'localabstract:webview_devtools_remote_456']);
  session.cleanup();
});

test('missing bundled page expires at the deadline and leaves no forward', async () => {
  const f = fixture({ fetchImpl: async () => ({ ok: true, json: async () => [] }) });
  await assert.rejects(connectDevtools(f.options), /within 500 ms: Bundled app page is not ready/);
  assert.equal(f.forwards.length, 5);
  assert.equal(f.removed.length, 5);
});

test('socket failure is retried and cleaned before another connection', async () => {
  let attempts = 0;
  class Socket {
    constructor() { queueMicrotask(() => ++attempts === 1 ? this.onerror?.() : this.onopen?.()); }
    close() { this.closed = true; }
  }
  const f = fixture({ WebSocketImpl: Socket });
  const session = await connectDevtools(f.options);
  assert.equal(attempts, 2);
  assert.deepEqual(f.removed, ['tcp:24001']);
  session.cleanup();
});

test('forward cleanup errors stop retrying and retain both failures', async () => {
  const f = fixture({ fetchImpl: async () => { throw new Error('socket reset'); } });
  const baseAdb = f.options.adb;
  f.options.adb = (...args) => {
    if (args[1] === '--remove') throw new Error('cleanup denied');
    return baseAdb(...args);
  };
  await assert.rejects(connectDevtools(f.options), error => error instanceof AggregateError &&
    error.errors.map(e => e.message).join('|') === 'socket reset|cleanup denied');
  assert.equal(f.forwards.length, 1);
});

test('render readiness waits for mounted content instead of a fixed delay', async () => {
  let calls = 0;
  const f = fixture();
  await waitForAppReady(async () => ++calls === 3, f.options);
  assert.equal(calls, 3);
});

test('render failure is bounded and evaluation errors are not swallowed', async () => {
  const f = fixture();
  let calls = 0;
  await assert.rejects(waitForAppReady(async () => { ++calls; return false; }, f.options), /did not render within 500 ms/);
  assert.equal(calls, 5);
  const failure = new Error('Application exception');
  await assert.rejects(waitForAppReady(async () => { throw failure; }, fixture().options), error => error === failure);
});


test('reload readiness ignores the previous document and retries only context replacement', async () => {
  const f = fixture();
  let calls = 0;
  await waitForAppReady(async (expression, timeoutMs) => {
    assert.match(expression, /performance.timeOrigin !== 12345/);
    assert.ok(timeoutMs > 0 && timeoutMs <= 500);
    if (++calls === 1) throw new Error('Execution context was destroyed.');
    return calls === 3;
  }, { ...f.options, previousTimeOrigin: 12345 });
  assert.equal(calls, 3);
});

test('a socket that never opens times out and closes its allocated forward', async () => {
  class NeverOpenSocket { close() { this.closed = true; } }
  const f = fixture({ timeoutMs: 20, intervalMs: 1, now: Date.now,
    delay: ms => new Promise(resolve => setTimeout(resolve, ms)), WebSocketImpl: NeverOpenSocket });
  await assert.rejects(connectDevtools(f.options), /was not ready within 20 ms/);
  assert.equal(f.forwards.length, f.removed.length);
});

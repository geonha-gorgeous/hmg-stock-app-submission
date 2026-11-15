const appUrl = 'https://appassets.androidplatform.net/index.html';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/** Wait only for startup transport; application assertions run after this returns. */
export async function connectDevtools({ adb, timeoutMs = 15000, intervalMs = 200,
  fetchImpl = fetch, WebSocketImpl = WebSocket, now = Date.now, delay = sleep }) {
  const deadline = now() + timeoutMs;
  let lastError;
  while (now() < deadline) {
    let port;
    let socket;
    const cleanup = () => {
      socket?.close();
      if (port) {
        const ownedPort = port;
        port = undefined;
        adb('forward', '--remove', `tcp:${ownedPort}`);
      }
    };
    try {
      const pid = adb('shell', 'pidof', 'tech.donda.pleos.debug').split(' ')[0];
      if (!/^\d+$/.test(pid)) throw new Error('Debug app PID is not ready. Launch the debug APK first.');
      port = adb('forward', 'tcp:0', `localabstract:webview_devtools_remote_${pid}`);
      if (!/^\d+$/.test(port)) throw new Error(`Invalid ADB forward port: ${port}`);
      const remaining = () => Math.max(1, Math.min(1000, deadline - now()));
      const response = await fetchImpl(`http://127.0.0.1:${port}/json/list`, {
        signal: AbortSignal.timeout(remaining()),
      });
      if (!response.ok) throw new Error(`DevTools list HTTP ${response.status}`);
      const pages = await response.json();
      if (!Array.isArray(pages)) throw new Error('Invalid DevTools page list.');
      const page = pages.find(candidate => candidate.url === appUrl);
      if (!page?.webSocketDebuggerUrl) throw new Error('Bundled app page is not ready.');
      socket = new WebSocketImpl(page.webSocketDebuggerUrl);
      await new Promise((resolve, reject) => {
        const finish = error => {
          clearTimeout(timer);
          socket.onopen = socket.onerror = socket.onclose = null;
          error ? reject(error) : resolve();
        };
        const timer = setTimeout(() => finish(new Error('DevTools socket open timed out.')), remaining());
        socket.onopen = () => finish();
        socket.onerror = () => finish(new Error('DevTools socket connection failed.'));
        socket.onclose = () => finish(new Error('DevTools socket closed before opening.'));
      });
      if (adb('shell', 'pidof', 'tech.donda.pleos.debug').split(' ')[0] !== pid) {
        throw new Error('Debug app PID changed during DevTools startup.');
      }
      if (now() >= deadline) throw new Error('DevTools startup deadline expired.');
      return { pid, page, socket, cleanup };
    } catch (error) {
      lastError = error;
      try { cleanup(); } catch (cleanupError) {
        throw new AggregateError([error, cleanupError], 'DevTools startup and forward cleanup failed.');
      }
      const remaining = deadline - now();
      if (remaining > 0) await delay(Math.min(intervalMs, remaining));
    }
  }
  throw new Error(`Debug app DevTools was not ready within ${timeoutMs} ms: ${lastError?.message ?? 'no attempt'}`, { cause: lastError });
}

/** Wait for a rendered app after reload without retrying product assertions. */
export async function waitForAppReady(evaluate, { timeoutMs = 10000, intervalMs = 100,
  previousTimeOrigin, now = Date.now, delay = sleep } = {}) {
  const deadline = now() + timeoutMs;
  while (now() < deadline) {
    const newDocument = previousTimeOrigin === undefined ? 'true' : `performance.timeOrigin !== ${JSON.stringify(previousTimeOrigin)}`;
    try {
      if (await evaluate(`${newDocument} && document.readyState === 'complete' && !!document.querySelector('[data-ccp-root] .app-dock')`, deadline - now())) return;
    } catch (error) {
      if (!/Execution context was destroyed|Cannot find context with specified id/.test(error.message)) throw error;
    }
    const remaining = deadline - now();
    if (remaining > 0) await delay(Math.min(intervalMs, remaining));
  }
  throw new Error(`Bundled app did not render within ${timeoutMs} ms.`);
}

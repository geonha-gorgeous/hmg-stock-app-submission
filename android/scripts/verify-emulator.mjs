// Run after install/launch: node android/scripts/verify-emulator.mjs emulator-5554
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { connectDevtools, waitForAppReady } from './devtools-readiness.mjs';
const serial = process.argv[2];
const runJourney = process.argv.includes('--journey');
if (!/^emulator-\d+$/.test(serial || '')) throw new Error('Pass an emulator serial. Physical-device installation is outside this check.');
const sdk = process.env.ANDROID_HOME || `${process.env.HOME}/Library/Android/sdk`;
const adbWithTimeout = (timeout, ...args) => execFileSync(`${sdk}/platform-tools/adb`, ['-s', serial, ...args], { encoding: 'utf8', timeout }).trim();
const adb = (...args) => adbWithTimeout(10000, ...args);
const { pid, page, socket, cleanup } = await connectDevtools({ adb: (...args) => adbWithTimeout(1000, ...args) });
let id = 0;
const pending = new Map();
socket.onmessage = event => { const result = JSON.parse(event.data); if (result.id && pending.has(result.id)) { const {resolve,reject} = pending.get(result.id); pending.delete(result.id); result.error ? reject(new Error(result.error.message)) : resolve(result.result); } };
socket.onclose = () => { for (const {reject} of pending.values()) reject(new Error('DevTools socket disconnected during verification.')); pending.clear(); };
socket.onerror = () => socket.onclose();
const command = (method, params = {}, timeoutMs = 10000) => new Promise((resolve, reject) => {
  const seq = ++id;
  const timer = setTimeout(() => { pending.delete(seq); reject(new Error(`CDP timeout: ${method}`)); }, timeoutMs);
  pending.set(seq, {resolve: result => {clearTimeout(timer);resolve(result);}, reject: error => {clearTimeout(timer);reject(error);}});
  try { socket.send(JSON.stringify({ id:seq, method, params })); } catch (error) { const entry = pending.get(seq); pending.delete(seq); entry?.reject(error); }
});
const evaluate = async (expression, timeoutMs) => {
  const result = await command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, timeoutMs);
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
};
const reloadApp = async () => {
  await waitForAppReady(evaluate);
  const previousTimeOrigin = await evaluate('performance.timeOrigin');
  await command('Page.reload');
  await waitForAppReady(evaluate, { previousTimeOrigin });
};
const pause = () => new Promise(resolve => setTimeout(resolve, 250));
try {
  await reloadApp();
  const status = await evaluate("fetch('/api/status').then(r=>r.json())");
  if (status.provider !== 'demo' || status.configured !== false) throw new Error('Offline demo status contract failed.');
  const blocked = await evaluate("fetch('https://example.com/blocked').then(r=>r.status).catch(()=>0)");
  if (blocked !== 403 && blocked !== 0) throw new Error('External network request was not blocked.');
  await evaluate("location.href='https://example.com/blocked';true");
  await pause();
  if (await evaluate('location.href') !== page.url) throw new Error('External navigation was not blocked.');
  await evaluate("if(window.__nativeRecorder)window.removeEventListener('pleos-ccp-input',window.__nativeRecorder);window.__nativeEvents=[];window.__nativeRecorder=e=>window.__nativeEvents.push(e.detail);window.addEventListener('pleos-ccp-input',window.__nativeRecorder);true");
  adb('shell', 'input', 'keyevent', 'KEYCODE_TAB');
  await pause();
  adb('shell', 'input', 'keyevent', 'KEYCODE_DPAD_DOWN');
  await pause();
  adb('shell', 'input', 'rotaryencoder', 'scroll', '--axis', 'SCROLL,-2');
  await pause();
  adb('shell', 'input', 'keyevent', '--longpress', 'KEYCODE_ENTER');
  await pause();
  const events = await evaluate('window.__nativeEvents');
  const expected = ['next', 'down', 'next', 'next', 'select'];
  if (JSON.stringify(events.map(e => e.action)) !== JSON.stringify(expected) || events.some(e => e.source !== 'android')) throw new Error(`Input translation/duplicate test failed: ${JSON.stringify(events)}`);
  let journey = null;
  if (runJourney) {
    await evaluate('localStorage.clear();true');
    await reloadApp();
    const key = async code => { adb('shell','input','keyevent', code); await pause(); };
    const moveTo = async selector => {
      for (let i = 0; i < 60; i++) {
        if (await evaluate(`!!document.querySelector(${JSON.stringify(selector)})?.matches('[data-ccp-focused="true"]')`)) return;
        await key('KEYCODE_TAB');
      }
      throw new Error(`Could not focus ${selector}`);
    };
    await key('KEYCODE_TAB');
    const initialFocus = await evaluate(`document.querySelector('[data-ccp-focused="true"]')?.getAttribute('data-ccp-label')`);
    if (initialFocus !== '삼성전자') throw new Error(`First input focus: ${initialFocus}`);
    await moveTo('[data-ccp-target="order-buy"]');
    await key('KEYCODE_ENTER');
    await new Promise(resolve => setTimeout(resolve, 350));
    if (!await evaluate(`!!document.querySelector('dialog[open] input[aria-label="주문 수량"]')`)) throw new Error('Order dialog did not open.');
    const modalInitialFocus = await evaluate(`document.querySelector('[data-ccp-focused="true"]')?.getAttribute('aria-label')`);
    await moveTo('dialog[open] input[aria-label="주문 수량"]');
    await key('KEYCODE_ENTER');
    adb('shell','input','rotaryencoder','scroll','--axis','SCROLL,-1');
    await pause();
    const quantity = await evaluate(`document.querySelector('dialog[open] input[aria-label="주문 수량"]').value`);
    if (quantity !== '2') throw new Error(`Quantity editing failed: ${quantity}`);
    await key('KEYCODE_ENTER');
    await moveTo('dialog[open] button.full.buy-button');
    await key('KEYCODE_ENTER');
    if (!await evaluate(`document.querySelector('dialog[open] .order-result h3')?.textContent === '접수되었습니다'`)) throw new Error('Demo order was not accepted.');
    const resultScreenshot = await command('Page.captureScreenshot', {format:'png'});
    const journeyOutput = fileURLToPath(new URL('../build/verification/', import.meta.url));
    mkdirSync(journeyOutput,{recursive:true});
    writeFileSync(`${journeyOutput}/order-accepted.png`,Buffer.from(resultScreenshot.data,'base64'));
    await key('KEYCODE_BACK');
    if (await evaluate(`!!document.querySelector('dialog[open]')`)) throw new Error('Lower-level Back did not dismiss the dialog.');
    const homeScreenshot = await command('Page.captureScreenshot', {format:'png'});
    writeFileSync(`${journeyOutput}/home-focus.png`,Buffer.from(homeScreenshot.data,'base64'));
    await key('KEYCODE_BACK');
    const activities = adb('shell','dumpsys','activity','activities');
    const stillForeground = activities.split('\n').some(line => /topResumedActivity|ResumedActivity:/.test(line) && line.includes('tech.donda.pleos.debug'));
    if (stillForeground) throw new Error('Top-level Back did not hide the app.');
    const alivePid = adb('shell','pidof','tech.donda.pleos.debug').split(' ')[0];
    if (alivePid !== pid) throw new Error('Back terminated/restarted the app process.');
    journey = {initialFocus, modalInitialFocus, quantity, accepted:true, lowerBackDismissed:true, topBackHidden:true, processRetained:true};
  }
  const output = fileURLToPath(new URL('../build/verification/', import.meta.url));
  mkdirSync(output, {recursive:true});
  if (!runJourney) {
    const screenshot = await command('Page.captureScreenshot', { format:'png' });
    writeFileSync(`${output}/native-input.png`, Buffer.from(screenshot.data, 'base64'));
  }
  writeFileSync(`${output}/native-input.json`, JSON.stringify({serial, androidVersion:adb('shell','getprop','ro.build.version.release'), hostOrigin:page.url, externalNavigationBlocked:true, externalRequestBlocked:true, status, events, journey, limitations:['Generic Android emulator; no Pleos RotaryService or vehicle hardware verification.']}, null, 2));
  console.log(JSON.stringify({ ok:true, events, journey, evidence:output }, null, 2));
} finally { cleanup(); }

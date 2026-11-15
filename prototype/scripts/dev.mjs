import { spawn } from 'node:child_process';

const preview = process.argv.includes('--preview');
const api = spawn(process.execPath, ['--env-file-if-exists=.env.local', 'server/index.ts'], { stdio: 'inherit' });
const ui = spawn(process.execPath, ['node_modules/vite/bin/vite.js', ...(preview ? ['preview'] : []), '--host', '127.0.0.1', '--port', process.env.UI_PORT || '4174', '--strictPort'], { stdio: 'inherit' });
let closing = false;
function stop(code = 0) {
  if (closing) return;
  closing = true;
  api.kill('SIGTERM'); ui.kill('SIGTERM');
  process.exitCode = code;
}
for (const child of [api, ui]) {
  child.on('error', () => stop(1));
  child.on('exit', code => stop(code || 0));
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => stop());

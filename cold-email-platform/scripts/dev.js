const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const dotenvModule = path.join(root, 'backend', 'node_modules', 'dotenv');
if (fs.existsSync(dotenvModule)) {
  const dotenv = require(dotenvModule);
  for (const envPath of [path.join(root, 'backend', '.env'), path.join(root, '.env')]) {
    if (fs.existsSync(envPath)) dotenv.config({ path: envPath, override: false });
  }
}
const services = [
  {
    name: 'backend',
    cwd: path.join(root, 'backend'),
    entry: path.join(root, 'backend', 'node_modules', 'tsx', 'dist', 'cli.mjs'),
    args: ['src/server.ts'],
    restart: true
  },
  {
    name: 'worker',
    cwd: path.join(root, 'worker'),
    entry: path.join(root, 'worker', 'node_modules', 'tsx', 'dist', 'cli.mjs'),
    args: ['watch', 'src/index.ts'],
    restart: true
  },
  {
    name: 'frontend',
    cwd: path.join(root, 'frontend'),
    entry: path.join(root, 'frontend', 'node_modules', 'next', 'dist', 'bin', 'next'),
    args: ['dev']
  }
].filter(service => !(service.name === 'worker' && process.env.RUN_WORKER?.trim().toLowerCase() === 'true'));

const missing = services.filter(service => !fs.existsSync(service.entry));
if (missing.length) {
  console.error(`Install dependencies before starting development services: ${missing.map(service => service.name).join(', ')}`);
  process.exit(1);
}

const children = new Map();
const restartDelays = [1000, 2000, 5000, 10000, 30000];
const restartAttempts = new Map();
let stopping = false;
let exitCode = 0;
const restartTimers = new Map();
let killTimer;

function finishShutdown() {
  if (!stopping || children.size) return;
  clearTimeout(killTimer);
  process.exitCode = exitCode;
}

function shutdown(code) {
  if (stopping) return;
  stopping = true;
  exitCode = code;
  for (const timer of restartTimers.values()) clearTimeout(timer);
  restartTimers.clear();
  for (const child of children.values()) child.kill('SIGTERM');
  killTimer = setTimeout(() => {
    for (const child of children.values()) child.kill('SIGKILL');
  }, 10000);
  killTimer.unref();
  finishShutdown();
}

function scheduleServiceRestart(service, startedAt) {
  const attempts = Date.now() - startedAt >= 60000 ? 1 : (restartAttempts.get(service.name) ?? 0) + 1;
  restartAttempts.set(service.name, attempts);
  const delay = restartDelays[Math.min(attempts - 1, restartDelays.length - 1)];
  console.error(`${service.name} exited unexpectedly; restarting in ${delay / 1000}s.`);
  const timer = setTimeout(() => {
    restartTimers.delete(service.name);
    startService(service);
  }, delay);
  restartTimers.set(service.name, timer);
}

function startService(service) {
  if (stopping) return;
  console.log(`Starting ${service.name}...`);
  const startedAt = Date.now();
  const child = spawn(process.execPath, [service.entry, ...service.args], {
    cwd: service.cwd,
    env: process.env,
    stdio: 'inherit'
  });
  let finalized = false;
  children.set(service.name, child);

  const finalize = (code, signal, error) => {
    if (finalized) return;
    finalized = true;
    children.delete(service.name);
    if (error) console.error(`${service.name} could not start: ${error.message}`);

    if (stopping) {
      finishShutdown();
    } else if (signal === 'SIGINT' || code === 130) {
      shutdown(0);
    } else if (service.restart) {
      scheduleServiceRestart(service, startedAt);
    } else {
      console.error(`${service.name} exited unexpectedly (code ${code ?? 'none'}, signal ${signal ?? 'none'}).`);
      shutdown(code || 1);
    }
  };

  child.once('error', error => finalize(null, null, error));
  child.once('exit', (code, signal) => finalize(code, signal));
}

process.once('SIGINT', () => shutdown(0));
process.once('SIGTERM', () => shutdown(0));
for (const service of services) startService(service);

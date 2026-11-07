const { rmSync } = require('node:fs');
const { spawn } = require('node:child_process');
const path = require('node:path');

const nextDirectory = path.join(__dirname, '..', '.next');
rmSync(nextDirectory, { recursive: true, force: true });

const next = spawn(
  process.execPath,
  [path.join(__dirname, '..', 'node_modules', 'next', 'dist', 'bin', 'next'), 'dev'],
  { stdio: 'inherit' },
);

next.on('exit', (code) => {
  process.exitCode = code ?? 0;
});

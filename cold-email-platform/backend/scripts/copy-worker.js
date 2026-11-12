const fs = require('node:fs');
const path = require('node:path');

const source = path.resolve(__dirname, '../../worker/dist');
const destination = path.resolve(__dirname, '../dist/embedded-worker');

if (!fs.existsSync(source)) {
  throw new Error('Worker build output is missing. Run the worker build before packaging the backend.');
}

fs.rmSync(destination, { recursive: true, force: true });
fs.mkdirSync(path.dirname(destination), { recursive: true });
fs.cpSync(source, destination, { recursive: true });

import { existsSync } from 'fs';
import { resolve } from 'path';
import type { Mongoose } from 'mongoose';
import type { ConnectionOptions, Queue } from 'bullmq';

type WorkerOptions = {
  database: Mongoose;
  redisConnection: ConnectionOptions;
  parseQueue: Queue;
};

type WorkerRuntimeModule = {
  startWorker(options: WorkerOptions): Promise<{ close(): Promise<void> }>;
};

export async function startEmbeddedWorker(options: WorkerOptions) {
  const builtRuntime = resolve(__dirname, '../../dist/embedded-worker/index.js');
  const sourceRuntime = resolve(__dirname, '../../../worker/src/index.ts');
  const runtimePath = existsSync(builtRuntime)
    ? builtRuntime
    : process.env.NODE_ENV === 'production' ? undefined : sourceRuntime;

  if (!runtimePath || !existsSync(runtimePath)) {
    throw new Error('Embedded worker runtime is missing. Build the worker before starting the backend with RUN_WORKER=true.');
  }

  const runtime = require(runtimePath) as WorkerRuntimeModule;
  return runtime.startWorker(options);
}

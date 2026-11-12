import dotenv from 'dotenv';
import { existsSync } from 'fs';
import { join, resolve } from 'path';
import mongoose from 'mongoose';
import type { Mongoose } from 'mongoose';
import { Queue, Worker } from 'bullmq';
import type { ConnectionOptions } from 'bullmq';
import { createWriteStream } from 'fs';
import { unlink } from 'fs/promises';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import crypto from 'crypto';
import pino from 'pino';
import { createWorkerModels } from './models';
import type { WorkerModels } from './models';
import { runSendWorker } from './sendWorker';
import { ParsedRecipientRow, parseCsvRows, parseXlsxRows } from './uploadParser';

function loadStandaloneEnvironment() {
  const candidatePaths = [
    resolve(__dirname, '../../.env'),
    resolve(__dirname, '../../backend/.env'),
    resolve(__dirname, '../.env'),
    resolve(__dirname, '../../.env.local')
  ].filter((value, index, array) => array.indexOf(value) === index);

  for (const envPath of candidatePaths) {
    if (existsSync(envPath)) dotenv.config({ path: envPath, override: false });
  }
}

if (require.main === module) loadStandaloneEnvironment();

const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' });
const mongoUri = process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017/cold_email';
const redisUrl = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';
const PARSE_QUEUE_NAME = 'file-parsing';
const WORKER_HEARTBEAT_KEY = 'file-parsing:worker:heartbeat';
const emailPattern = /^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+$/i;
const emailPatternSearch = /[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+/i;
const frequentlyUsedRolePrefixes = new Set([
  'admin', 'administrator', 'billing', 'careers', 'contact', 'enquiries', 'hello',
  'help', 'info', 'jobs', 'marketing', 'no-reply', 'noreply', 'office', 'sales',
  'support', 'team', 'webmaster'
]);
const lowerEmail = (value: unknown) => String(value ?? '').trim().toLowerCase();
const validEmail = (value: string) => value.length <= 254 && emailPattern.test(value);
const emailIssue = (email: string): { invalid: true; code: string; message: string } | undefined => {
  if (!validEmail(email)) return { invalid: true, code: 'INVALID_EMAIL', message: 'Invalid email address' };
  const localPart = email.split('@')[0];
  if (frequentlyUsedRolePrefixes.has(localPart)) return { invalid: true, code: 'ROLE_EMAIL', message: 'Frequently used role-based email address' };
  return undefined;
};
const nameFromEmail = (email: string) => email.split('@')[0].replace(/[._-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

type ParsedRow = { email: string; name?: string; company?: string; invalid?: boolean; error?: string; errorCode?: string };
async function persistBatch(rows: ParsedRow[], campaignId: string, userId: string, models: WorkerModels): Promise<number> {
  const seen = new Map<string, ParsedRow>(); for (const row of rows) seen.set(row.email, row);
  if (!seen.size) return 0;
  const result = await models.Recipient.bulkWrite([...seen.values()].map(row => ({
    updateOne: { filter: { campaignId, email: row.email }, update: { $setOnInsert: { campaignId, userId, email: row.email, name: row.name, company: row.company, status: row.invalid ? 'invalid' : 'pending', error: row.invalid ? row.error : undefined, errorCode: row.invalid ? row.errorCode : undefined, attempts: 0, idempotencyKey: crypto.createHash('sha256').update(`${campaignId}:${row.email}`).digest('hex') } }, upsert: true }
  })), { ordered: false });
  return result.upsertedCount ?? 0;
}

function classify(email: string): Pick<ParsedRow, 'invalid' | 'error' | 'errorCode'> {
    const issue = emailIssue(email);
    return issue ? { invalid: true, error: issue.message, errorCode: issue.code } : { invalid: false };
}

function extractEmails(text: string): string[] {
  return text.match(new RegExp(emailPatternSearch.source, 'gi')) ?? [];
}

async function parseAndPersist(stream: Readable, kind: 'csv'|'xlsx'|'pdf', upload: any, models: WorkerModels) {
  let rowsScanned = 0;
  let recipientsFound = 0;
  let recipientsInserted = 0;
  let sinceProgressUpdate = 0;
  const batch: ParsedRow[] = [];
  const reportProgress = async (force = false) => {
    if (!force && sinceProgressUpdate < 100) return;
    await models.Upload.updateOne({ _id: upload.id, status: 'processing' }, {
      $set: { rowsScanned, recipientsFound, recipientsInserted }
    });
    sinceProgressUpdate = 0;
  };
  const flush = async () => {
    if (batch.length) {
      const rows = batch.splice(0);
      recipientsInserted += await persistBatch(rows, String(upload.campaignId), String(upload.userId), models);
    }
    await reportProgress(true);
  };
  const addRowRecipients = (row: ParsedRecipientRow) => {
    for (const recipient of row.recipients) {
      const email = lowerEmail(recipient.email);
      if (!email) continue;
      recipientsFound++;
      batch.push({ email, name: recipient.name, company: recipient.company, ...classify(email) });
    }
  };
  const finishRow = async () => {
    rowsScanned++;
    sinceProgressUpdate++;
    if (batch.length >= 250) await flush();
    else await reportProgress();
  };

  if (kind === 'csv') {
    for await (const row of parseCsvRows(stream)) {
      addRowRecipients(row);
      await finishRow();
    }
  } else if (kind === 'xlsx') {
    for await (const row of parseXlsxRows(upload.tempFilePath)) {
      addRowRecipients(row);
      await finishRow();
    }
  } else {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    const pdf = require('pdf-parse');
    const parsed = await pdf(Buffer.concat(chunks));
    for (const found of extractEmails(parsed.text)) batch.push({ email: lowerEmail(found), name: nameFromEmail(lowerEmail(found)), ...classify(lowerEmail(found)) });
    recipientsFound = batch.length;
    rowsScanned = parsed.numpages ?? 0;
  }

  await flush();
  if (!recipientsFound) throw new Error('No recipient email addresses were found in the uploaded file');
  logger.info({ uploadId: upload.id, rowsScanned, recipientsFound, recipientsInserted }, 'Recipients parsed');
}

async function parseUpload(upload: any, database: Mongoose, models: WorkerModels) {
  const db = database.connection.db;
  if (!db) throw new Error('MongoDB connection is not ready for upload processing');
  const bucket = new database.mongo.GridFSBucket(db);
  const extension = String(upload.originalName ?? '').toLowerCase().split('.').pop();
  if (extension === 'xlsx') {
    const tempFilePath = join(tmpdir(), `recipient-upload-${upload.id}-${randomUUID()}.xlsx`);
    try {
      await pipeline(bucket.openDownloadStream(upload.gridFsId), createWriteStream(tempFilePath));
      await parseAndPersist(Readable.from([]), 'xlsx', { ...upload.toObject(), id: upload.id, tempFilePath }, models);
    } finally {
      await unlink(tempFilePath).catch(error => {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      });
    }
    return;
  }

  const stream = bucket.openDownloadStream(upload.gridFsId);
  await parseAndPersist(stream, extension === 'pdf' ? 'pdf' : 'csv', upload, models);
}

export interface WorkerRuntimeOptions {
  database?: Mongoose;
  redisConnection?: ConnectionOptions;
  parseQueue?: Queue;
}

export interface WorkerRuntime {
  close(): Promise<void>;
}

export async function startWorker(options: WorkerRuntimeOptions = {}): Promise<WorkerRuntime> {
  const database = options.database ?? mongoose;
  const ownsDatabase = options.database === undefined;
  if (database.connection.readyState !== 1) {
    if (!ownsDatabase) throw new Error('The shared MongoDB connection must be connected before starting the embedded worker');
    await database.connect(mongoUri);
  }
  logger.info('Worker connected to MongoDB');

  const models = createWorkerModels(database);
  const connection = options.redisConnection ?? { url: redisUrl, maxRetriesPerRequest: null } as ConnectionOptions;
  const ownsParseQueue = options.parseQueue === undefined;
  const parseQueue = options.parseQueue ?? new Queue(PARSE_QUEUE_NAME, { connection });
  let closeSendWorker: (() => Promise<void>) | undefined;
  let worker: Worker | undefined;
  let redisClient: Awaited<Worker['client']> | undefined;
  let heartbeatTimer: NodeJS.Timeout | undefined;
  let recoveryTimer: NodeJS.Timeout | undefined;
  const closeResources = async () => {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    if (recoveryTimer) clearInterval(recoveryTimer);
    let firstError: unknown;
    const attempt = async (operation: () => Promise<unknown>) => {
      try {
        await operation();
      } catch (error) {
        firstError ??= error;
      }
    };
    const client = redisClient;
    if (client) await attempt(() => client.del(WORKER_HEARTBEAT_KEY));
    const parseWorker = worker;
    if (parseWorker) await attempt(() => parseWorker.close());
    const closeSender = closeSendWorker;
    if (closeSender) await attempt(() => closeSender());
    if (ownsParseQueue) await attempt(() => parseQueue.close());
    if (ownsDatabase) await attempt(() => database.disconnect());
    if (firstError) throw firstError;
  };

  const updateUploadStatus = async (uploadId: string, status: string, extra: Record<string, unknown> = {}, expectedStatus?: string | string[]) => {
    const upload = await models.Upload.findById(uploadId).select('status');
    if (!upload || !upload.status) return false;
    const currentStatus = upload.status;
    if (expectedStatus && !(Array.isArray(expectedStatus) ? expectedStatus : [expectedStatus]).includes(currentStatus)) return false;
    if (currentStatus === status) {
      if (Object.keys(extra).length) await models.Upload.updateOne({ _id: uploadId, status }, { $set: extra });
      return true;
    }
    const result = await models.Upload.updateOne({ _id: uploadId, status: currentStatus }, {
      $set: { status, statusChangedAt: new Date(), ...extra }
    });
    if (result.modifiedCount) logger.info({ uploadId, from: currentStatus, to: status }, 'Upload status changed');
    return result.modifiedCount > 0;
  };
  const enqueueUpload = async (upload: any) => {
    await parseQueue.add('parse-upload', {
      uploadId: upload.id,
      userId: String(upload.userId),
      campaignId: String(upload.campaignId)
    }, { jobId: upload.id, attempts: 1, removeOnComplete: true, removeOnFail: false });
  };
  const recoverStuckUploads = async () => {
    const now = Date.now();
    const stuckProcessing = await models.Upload.find({
      status: 'processing',
      $or: [
        { statusChangedAt: { $lt: new Date(now - 10 * 60 * 1000) } },
        { statusChangedAt: { $exists: false }, updatedAt: { $lt: new Date(now - 10 * 60 * 1000) } }
      ]
    }).select('_id');
    for (const upload of stuckProcessing) {
      const cutoff = new Date(now - 10 * 60 * 1000);
      const result = await models.Upload.updateOne({
        _id: upload.id,
        status: 'processing',
        $or: [
          { statusChangedAt: { $lt: cutoff } },
          { statusChangedAt: { $exists: false }, updatedAt: { $lt: cutoff } }
        ]
      }, {
        $set: {
          status: 'failed',
          statusChangedAt: new Date(),
          error: 'Processing exceeded 10 minutes and was stopped by recovery. Retry this upload.'
        }
      });
      if (result.modifiedCount) logger.info({ uploadId: upload.id, from: 'processing', to: 'failed' }, 'Upload status changed');
    }

    const stuckQueued = await models.Upload.find({
      status: { $in: ['queued', 'uploaded'] },
      $or: [
        { queuedAt: { $lt: new Date(now - 2 * 60 * 1000) } },
        { queuedAt: { $exists: false }, createdAt: { $lt: new Date(now - 2 * 60 * 1000) } }
      ]
    });
    for (const upload of stuckQueued) {
      const currentJob = await parseQueue.getJob(upload.id);
      const state = currentJob ? await currentJob.getState() : null;
      if (state === 'active') continue;
      if (currentJob) await currentJob.remove();
      const queuedAt = new Date();
      if (upload.status === 'uploaded') {
        await updateUploadStatus(upload.id, 'queued', { queuedAt }, 'uploaded');
      } else {
        await models.Upload.updateOne({ _id: upload.id, status: 'queued' }, { $set: { queuedAt } });
      }
      await enqueueUpload(upload);
      logger.warn({ uploadId: upload.id, previousQueueState: state }, 'Re-queued stuck upload');
    }
  };
  try {
    closeSendWorker = await runSendWorker(models, connection);
    worker = new Worker(PARSE_QUEUE_NAME, async job => {
      const { uploadId } = job.data as { uploadId: string };
      logger.info({ uploadId }, 'parse job received');
      const upload = await models.Upload.findById(uploadId);
      if (!upload) throw new Error(`Upload ${uploadId} was not found`);
      const started = await updateUploadStatus(uploadId, 'processing', {
        statusChangedAt: new Date(),
        rowsScanned: 0,
        recipientsFound: 0,
        recipientsInserted: 0,
        error: undefined
      }, ['queued', 'uploaded']);
      if (!started) throw new Error(`Upload ${uploadId} is no longer queued`);

      let timeout: NodeJS.Timeout | undefined;
      try {
        const timeoutPromise = new Promise<never>((_, reject) => {
          timeout = setTimeout(() => reject(new Error('Recipient processing timed out after 5 minutes. Retry this upload.')), 5 * 60 * 1000);
        });
        await Promise.race([parseUpload(upload, database, models), timeoutPromise]);
        await updateUploadStatus(uploadId, 'processed', { error: undefined }, 'processing');
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Recipient processing failed unexpectedly';
        await updateUploadStatus(uploadId, 'failed', { error: message }, 'processing');
        throw error;
      } finally {
        if (timeout) clearTimeout(timeout);
      }
    }, { connection, concurrency: Number(process.env.WORKER_CONCURRENCY ?? 2) });
    const client = await worker.client;
    redisClient = client;
    const writeHeartbeat = async () => {
      try {
        await client.set(WORKER_HEARTBEAT_KEY, String(Date.now()), { EX: 30 });
      } catch (error) {
        logger.error({ error }, 'Unable to write worker heartbeat');
      }
    };
    await writeHeartbeat();
    heartbeatTimer = setInterval(() => { void writeHeartbeat(); }, 10_000);
    await recoverStuckUploads();
    recoveryTimer = setInterval(() => {
      recoverStuckUploads().catch(error => logger.error({ error }, 'Upload recovery failed'));
    }, 60_000);
    worker.on('ready', () => logger.info('Worker started'));
    worker.on('failed', (job, error) => logger.error({ jobId: job?.id, error: error.message }, 'Parsing job failed'));
    logger.info({ parseQueueName: PARSE_QUEUE_NAME, redisUrl: new URL(redisUrl).host }, 'File parsing worker configured');
  } catch (error) {
    try {
      await closeResources();
    } catch (cleanupError) {
      logger.error({ cleanupError }, 'Worker startup cleanup failed');
    }
    throw error;
  }

  let closePromise: Promise<void> | undefined;
  return {
    close() {
      if (!closePromise) closePromise = closeResources();
      return closePromise;
    }
  };
}

async function main() {
  const runtime = await startWorker();
  const shutdown = async () => {
    try {
      await runtime.close();
      process.exit(0);
    } catch (error) {
      logger.error(error);
      process.exit(1);
    }
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

if (require.main === module) {
  main().catch(error => { logger.error(error); process.exit(1); });
}

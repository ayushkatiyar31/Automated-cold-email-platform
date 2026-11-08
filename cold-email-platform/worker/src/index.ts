import dotenv from 'dotenv';
dotenv.config();
import mongoose from 'mongoose';
import { Worker } from 'bullmq';
import { Readable } from 'stream';
import { parse as csvParse } from 'csv-parse';
import ExcelJS from 'exceljs';
import crypto from 'crypto';
import pino from 'pino';
import { Upload, Recipient } from './models';
import { runSendWorker } from './sendWorker';

const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' });
const mongoUri = process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017/cold_email';
const redisUrl = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';
const emailPattern = /[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+/i;
const lowerEmail = (value: unknown) => String(value ?? '').trim().toLowerCase();
const validEmail = (value: string) => value.length <= 254 && emailPattern.test(value);
const nameFromEmail = (email: string) => email.split('@')[0].replace(/[._-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

type ParsedRow = { email: string; name?: string; company?: string; invalid?: boolean };
async function persistBatch(rows: ParsedRow[], campaignId: string, userId: string) {
  const seen = new Map<string, ParsedRow>(); for (const row of rows) seen.set(row.email, row);
  if (!seen.size) return;
  await (Recipient as any).bulkWrite([...seen.values()].map(row => ({
    updateOne: { filter: { campaignId, email: row.email }, update: { $setOnInsert: { campaignId, userId, email: row.email, name: row.name, company: row.company, status: row.invalid ? 'invalid' : 'pending', error: row.invalid ? 'Invalid email address' : undefined, errorCode: row.invalid ? 'INVALID_EMAIL' : undefined, attempts: 0, idempotencyKey: crypto.createHash('sha256').update(`${campaignId}:${row.email}`).digest('hex') } }, upsert: true }
  })), { ordered: false });
}
async function parseAndPersist(stream: Readable, kind: 'csv'|'xlsx'|'pdf', upload: any) {
  const queue: ParsedRow[] = []; let seen = 0;
  const flush = async () => { const rows = queue.splice(0); await persistBatch(rows, String(upload.campaignId), String(upload.userId)); seen += rows.length; };
  if (kind === 'csv') {
    await new Promise<void>((resolve, reject) => {
      stream.pipe(csvParse({ columns: true, bom: true, trim: true })).on('data', row => { if (stream.destroyed) return; const headers = Object.keys(row); const emailKey = headers.find(k => /email/i.test(k)); if (!emailKey) return; const email = lowerEmail(row[emailKey]); queue.push({ email, name: row.name?.trim() || undefined, company: row.company?.trim() || undefined, invalid: !validEmail(email) }); if (queue.length >= 1000) { stream.pause(); flush().catch(reject).finally(() => stream.resume()); } }).on('error', reject).on('end', resolve);
    });
  } else if (kind === 'xlsx') {
    const workbook = new ExcelJS.Workbook(); await workbook.xlsx.read(stream as any);
    const sheet = workbook.worksheets[0]; if (!sheet) throw new Error('Workbook has no worksheets');
    let headerRow = 0; let emailIndex = 0; let nameIndex = 0; let companyIndex = 0;
    for (let rowNumber = 1; rowNumber <= Math.min(sheet.rowCount, 20); rowNumber++) {
      const headers = sheet.getRow(rowNumber).values as unknown[];
      const normalized = headers.map(v => String(v ?? '').trim().toLowerCase());
      emailIndex = normalized.findIndex(v => /e[- ]?mail|email address/.test(v));
      if (emailIndex > 0) {
        headerRow = rowNumber;
        nameIndex = normalized.findIndex(v => /^(full )?name$/.test(v));
        companyIndex = normalized.findIndex(v => /company|organization|organisation/.test(v));
        break;
      }
    }
    if (!headerRow || emailIndex < 1) throw new Error('Worksheet must contain an email column');
    const cellText = (row: ExcelJS.Row, index: number) => index > 0 ? String(row.getCell(index).text ?? '').trim() : '';
    sheet.eachRow((row, rowNumber) => {
      if (rowNumber <= headerRow) return;
      const email = lowerEmail(cellText(row, emailIndex));
      if (validEmail(email)) queue.push({ email, name: cellText(row, nameIndex) || undefined, company: cellText(row, companyIndex) || undefined });
    });
  } else {
    const chunks: Buffer[]=[]; for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    const pdf = require('pdf-parse'); const parsed = await pdf(Buffer.concat(chunks)); const matches = parsed.text.match(new RegExp(emailPattern.source, 'gi')) ?? [];
    for (const found of matches) { const email = lowerEmail(found); if (validEmail(email)) queue.push({ email, name: nameFromEmail(email) }); }
  }
  if (queue.length) await persistBatch(queue, String(upload.campaignId), String(upload.userId));
  logger.info({ uploadId: upload.id, seen, campaignId: upload.campaignId }, 'Recipients parsed');
}

async function main() {
  await mongoose.connect(mongoUri); logger.info('Worker connected to MongoDB');
  await runSendWorker();
  const worker = new Worker('file-parsing', async job => {
    const { uploadId } = job.data as { uploadId: string }; const upload = await Upload.findById(uploadId); if (!upload) throw new Error('Upload not found');
    await Upload.updateOne({ _id: uploadId }, { $set: { status: 'processing' } });
    try {
      const bucket = new mongoose.mongo.GridFSBucket(mongoose.connection.db!); const stream = bucket.openDownloadStream(upload.gridFsId);
      const ext = String(upload.originalName ?? '').toLowerCase().split('.').pop(); await parseAndPersist(stream, ext === 'xlsx' ? 'xlsx' : ext === 'pdf' ? 'pdf' : 'csv', upload);
      await Upload.updateOne({ _id: uploadId }, { $set: { status: 'processed' }, $unset: { error: 1 } });
    } catch (error: any) { await Upload.updateOne({ _id: uploadId }, { $set: { status: 'failed', error: error.message } }); throw error; }
  }, { connection: { url: redisUrl, maxRetriesPerRequest: null } as any, concurrency: Number(process.env.WORKER_CONCURRENCY ?? 2) });
  worker.on('ready', () => logger.info('Worker started'));
  worker.on('failed', (job, error) => logger.error({ jobId: job?.id, error: error.message }, 'Parsing job failed'));
  const shutdown = async () => { await worker.close(); await mongoose.disconnect(); process.exit(0); }; process.once('SIGINT', shutdown); process.once('SIGTERM', shutdown);
}
main().catch(error => { logger.error(error); process.exit(1); });

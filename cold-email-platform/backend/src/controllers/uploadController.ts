import { RequestHandler } from 'express';
import mongoose from 'mongoose';
import { createReadStream, readFileSync, unlinkSync } from 'fs';
import { extname } from 'path';
import { z } from 'zod';
import { IUpload, Upload } from '../models/Upload';
import { Campaign } from '../models/Campaign';
import { AuthRequest } from '../middleware/auth';
import { AppError, notFound } from '../utils/errors';
import { assertOwner, objectId } from '../utils/ownership';
import { logger } from '../config/logger';
import { parseQueue } from '../services/queue';

const extTypes: Record<string, string> = { '.csv': 'text/csv', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.pdf': 'application/pdf' };
async function validateMagic(path: string, ext: string) {
  const head = readFileSync(path); const magic = head.subarray(0, Math.min(head.length, 4096));
  if (ext === '.xlsx' && !(magic[0] === 0x50 && magic[1] === 0x4b && magic[2] === 0x03 && magic[3] === 0x04)) throw new AppError(400, 'Invalid XLSX file', 'INVALID_FILE');
  if (ext === '.pdf' && magic.subarray(0, 4).toString('ascii') !== '%PDF') throw new AppError(400, 'Invalid PDF file', 'INVALID_FILE');
  if (ext === '.csv' && (head.length === 0 || head.includes(0))) throw new AppError(400, 'Invalid CSV file', 'INVALID_FILE');
}

export const uploadFile: RequestHandler = async (req, res, next) => {
  let createdUpload: IUpload | undefined;
  try {
    const campaignId = objectId(z.object({ campaignId: z.string() }).parse(req.body).campaignId);
    const user = (req as AuthRequest).user!; const campaign = await Campaign.findById(campaignId);
    if (!campaign) throw notFound('Campaign not found'); assertOwner(campaign.userId, user.id);
    const file = req.file; if (!file) throw new AppError(400, 'A file is required', 'FILE_REQUIRED');
    const ext = extname(file.originalname).toLowerCase(); const mime = extTypes[ext];
    if (!mime) { unlinkSync(file.path); throw new AppError(400, 'Only CSV, XLSX or PDF files are accepted', 'INVALID_FILE'); }
    await validateMagic(file.path, ext);
    const bucket = new mongoose.mongo.GridFSBucket(mongoose.connection.db!);
    const uploadStream = bucket.openUploadStream(file.originalname, { metadata: { userId: user.id, campaignId, contentType: mime } });
    await new Promise<void>((resolve, reject) => { createReadStream(file.path).on('error', reject).pipe(uploadStream).on('error', reject).on('finish', resolve); });
    const queuedAt = new Date();
    const upload = await Upload.create({
      userId: user.id,
      campaignId,
      originalName: file.originalname,
      mimeType: mime,
      size: file.size,
      gridFsId: uploadStream.id,
      status: 'queued',
      queuedAt,
      statusChangedAt: queuedAt,
      rowsScanned: 0,
      recipientsFound: 0,
      recipientsInserted: 0
    });
    createdUpload = upload;
    logger.info({ uploadId: upload.id, from: null, to: 'queued' }, 'Upload status changed');
    unlinkSync(file.path);
    const job = await parseQueue.add('parse-upload', { uploadId: upload.id, userId: user.id, campaignId }, { jobId: String(upload.id), attempts: 1, removeOnComplete: true, removeOnFail: false });
    res.status(202).json({ upload: { id: upload.id, status: upload.status, rowsScanned: 0, recipientsFound: 0, recipientsInserted: 0 }, queueState: await job.getState() });
  } catch (error) {
    if (createdUpload) {
      const message = error instanceof Error ? error.message : 'Unable to queue upload for processing';
      await Upload.updateOne({ _id: createdUpload.id }, { $set: { status: 'failed', error: message, statusChangedAt: new Date() } });
      logger.info({ uploadId: createdUpload.id, from: 'queued', to: 'failed', error: message }, 'Upload status changed');
    }
    if (req.file) { try { unlinkSync(req.file.path); } catch {} }
    next(error);
  }
};

export const uploadStatus: RequestHandler = async (req, res, next) => {
  try {
    const upload = await Upload.findById(objectId(req.params.id));
    if (!upload) throw notFound('Upload not found');
    assertOwner(upload.userId, (req as AuthRequest).user!.id);
    const job = await parseQueue.getJob(upload.id);
    const queueState = job ? await job.getState() : null;
    res.json({ upload: { ...upload.toObject(), id: upload.id }, queueState });
  } catch (error) { next(error); }
};

export const retryUpload: RequestHandler = async (req, res, next) => {
  try {
    const upload = await Upload.findById(objectId(req.params.id));
    if (!upload) throw notFound('Upload not found');
    assertOwner(upload.userId, (req as AuthRequest).user!.id);
    if (upload.status !== 'failed') throw new AppError(409, 'Only failed uploads can be retried', 'UPLOAD_NOT_FAILED');

    const existingJob = await parseQueue.getJob(upload.id);
    if (existingJob && await existingJob.getState() === 'active') {
      throw new AppError(409, 'This upload is still being processed. Try again when the active job has stopped.', 'UPLOAD_IN_PROGRESS');
    }
    if (existingJob) await existingJob.remove();
    const queuedAt = new Date();
    await Upload.updateOne({ _id: upload.id }, {
      $set: { status: 'queued', queuedAt, statusChangedAt: queuedAt, rowsScanned: 0, recipientsFound: 0, recipientsInserted: 0 },
      $unset: { error: 1 }
    });
    logger.info({ uploadId: upload.id, from: 'failed', to: 'queued' }, 'Upload status changed');
    let job;
    try {
      job = await parseQueue.add('parse-upload', {
        uploadId: upload.id,
        userId: upload.userId,
        campaignId: upload.campaignId
      }, {
        jobId: upload.id,
        attempts: 1,
        removeOnComplete: true,
        removeOnFail: false
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to queue upload for retry';
      await Upload.updateOne({ _id: upload.id, status: 'queued' }, {
        $set: { status: 'failed', error: message, statusChangedAt: new Date() }
      });
      logger.info({ uploadId: upload.id, from: 'queued', to: 'failed', error: message }, 'Upload status changed');
      throw error;
    }
    res.status(202).json({
      upload: { ...upload.toObject(), id: upload.id, status: 'queued', error: undefined, rowsScanned: 0, recipientsFound: 0, recipientsInserted: 0 },
      queueState: await job.getState()
    });
  } catch (error) { next(error); }
};
export const deleteUpload: RequestHandler = async (req, res, next) => {
  try { const upload = await Upload.findById(objectId(req.params.id)); if (!upload) throw notFound('Upload not found'); assertOwner(upload.userId, (req as AuthRequest).user!.id); await upload.deleteOne(); res.status(204).send(); } catch (error) { next(error); }
};

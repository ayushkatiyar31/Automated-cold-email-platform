import { RequestHandler } from 'express';
import mongoose from 'mongoose';
import { createReadStream, readFileSync, unlinkSync } from 'fs';
import { extname } from 'path';
import { z } from 'zod';
import { Upload } from '../models/Upload';
import { Campaign } from '../models/Campaign';
import { AuthRequest } from '../middleware/auth';
import { AppError, notFound } from '../utils/errors';
import { assertOwner, objectId } from '../utils/ownership';
import { parseQueue } from '../services/queue';

const extTypes: Record<string, string> = { '.csv': 'text/csv', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.pdf': 'application/pdf' };
async function validateMagic(path: string, ext: string) {
  const head = readFileSync(path); const magic = head.subarray(0, Math.min(head.length, 4096));
  if (ext === '.xlsx' && !(magic[0] === 0x50 && magic[1] === 0x4b && magic[2] === 0x03 && magic[3] === 0x04)) throw new AppError(400, 'Invalid XLSX file', 'INVALID_FILE');
  if (ext === '.pdf' && magic.subarray(0, 4).toString('ascii') !== '%PDF') throw new AppError(400, 'Invalid PDF file', 'INVALID_FILE');
  if (ext === '.csv' && (head.length === 0 || head.includes(0))) throw new AppError(400, 'Invalid CSV file', 'INVALID_FILE');
}

export const uploadFile: RequestHandler = async (req, res, next) => {
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
    const upload = await Upload.create({ userId: user.id, campaignId, originalName: file.originalname, mimeType: mime, size: file.size, gridFsId: uploadStream.id, status: 'uploaded' });
    unlinkSync(file.path);
    await parseQueue.add('parse-upload', { uploadId: upload.id, userId: user.id, campaignId }, { jobId: String(upload.id), attempts: 3, backoff: { type: 'exponential', delay: 5000 }, removeOnComplete: true, removeOnFail: false });
    res.status(202).json({ upload: { id: upload.id, status: upload.status } });
  } catch (error) { if (req.file) { try { unlinkSync(req.file.path); } catch {} } next(error); }
};

export const uploadStatus: RequestHandler = async (req, res, next) => {
  try { const upload = await Upload.findById(objectId(req.params.id)); if (!upload) throw notFound('Upload not found'); assertOwner(upload.userId, (req as AuthRequest).user!.id); res.json({ upload }); } catch (error) { next(error); }
};
export const deleteUpload: RequestHandler = async (req, res, next) => {
  try { const upload = await Upload.findById(objectId(req.params.id)); if (!upload) throw notFound('Upload not found'); assertOwner(upload.userId, (req as AuthRequest).user!.id); await upload.deleteOne(); res.status(204).send(); } catch (error) { next(error); }
};

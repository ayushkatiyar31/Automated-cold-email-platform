import { RequestHandler } from 'express';
import { z } from 'zod';
import { Recipient } from '../models/Recipient';
import { Campaign } from '../models/Campaign';
import { AuthRequest } from '../middleware/auth';
import { AppError, notFound } from '../utils/errors';
import { assertOwner, objectId } from '../utils/ownership';

export const listRecipients: RequestHandler = async (req, res, next) => {
  try {
    const query = z.object({ campaignId: z.string(), page: z.coerce.number().int().positive().default(1), limit: z.coerce.number().int().min(1).max(100).default(20), search: z.string().trim().max(200).optional(), status: z.enum(['pending','sending','sent','failed','skipped']).optional() }).parse(req.query);
    const campaign = await Campaign.findById(objectId(query.campaignId)); if (!campaign) throw notFound('Campaign not found'); assertOwner(campaign.userId, (req as AuthRequest).user!.id);
    const filter: any = { campaignId: campaign.id }; if (query.search) filter.$or = ['email','name','company'].map(field => ({ [field]: { $regex: query.search, $options: 'i' } }));
    if (query.status) filter.status = query.status;
    const [items, total] = await Promise.all([Recipient.find(filter).sort({ email: 1 }).skip((query.page - 1) * query.limit).limit(query.limit).lean(), Recipient.countDocuments(filter)]);
    res.json({ items, total, page: query.page, pages: Math.ceil(total / query.limit) });
  } catch (error) { next(error); }
};
export const updateRecipient: RequestHandler = async (req, res, next) => {
  try {
    const input = z.object({ email: z.string().email().transform(v => v.trim().toLowerCase()).optional(), name: z.string().trim().max(120).optional(), company: z.string().trim().max(120).optional() }).parse(req.body);
    const recipient = await Recipient.findById(objectId(req.params.id)); if (!recipient) throw notFound('Recipient not found'); assertOwner(recipient.userId, (req as AuthRequest).user!.id);
    Object.assign(recipient, input); await recipient.save(); res.json({ recipient });
  } catch (error: any) { if (error?.code === 11000) next(new AppError(409, 'This email already exists in the campaign', 'DUPLICATE_EMAIL')); else next(error); }
};
export const deleteRecipient: RequestHandler = async (req, res, next) => {
  try { const recipient = await Recipient.findById(objectId(req.params.id)); if (!recipient) throw notFound('Recipient not found'); assertOwner(recipient.userId, (req as AuthRequest).user!.id); await recipient.deleteOne(); res.status(204).send(); } catch (error) { next(error); }
};
export const bulkDeleteRecipients: RequestHandler = async (req, res, next) => {
  try {
    const input = z.object({ ids: z.array(z.string().min(1)).min(1).max(1000) }).parse(req.body);
    const recipients = await Recipient.find({ _id: { $in: input.ids.map(objectId) } });
    for (const recipient of recipients) assertOwner(recipient.userId, (req as AuthRequest).user!.id);
    await Recipient.deleteMany({ _id: { $in: recipients.map(item => item.id) } });
    res.status(204).send();
  } catch (error) { next(error); }
};

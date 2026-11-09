import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { AuthRequest } from '../middleware/auth';
import { Campaign } from '../models/Campaign';
import { User } from '../models/User';
import { AppError, notFound } from '../utils/errors';
import { assertOwner, objectId } from '../utils/ownership';
import { sendOneEmail } from '../services/sendGmail';
import { Template } from '../models/Template';
import { Recipient } from '../models/Recipient';
import { renderCampaign, validatePlaceholders } from '../services/templateRenderer';
import { sendCampaign } from '../services/campaignQueue';
import { exportRecipients, exportReport } from '../controllers/campaignExportController';
const router = Router();
router.use(requireAuth);

const campaignInput = z.object({
  name: z.string().trim().min(1).max(100),
  subject: z.string().trim().min(1).max(998),
  body: z.string().trim().min(1).max(100000),
  resumeLink: z.string().url().max(2048).optional().or(z.literal('')),
  includeResumeLink: z.boolean().optional(),
  optOutEnabled: z.boolean().optional(),
  optOutLine: z.string().trim().max(1000).optional().or(z.literal(''))
});

router.get('/', async (req, res, next) => {
  try {
    const query = z.object({ page: z.coerce.number().int().positive().default(1), limit: z.coerce.number().int().min(1).max(100).default(20), search: z.string().trim().optional(), status: z.enum(['draft','pending','sending','sent','paused','cancelled','failed']).optional() }).parse(req.query);
    const filter: any = { userId: (req as AuthRequest).user!.id };
    if (query.search) filter.$or = [{ name: { $regex: query.search, $options: 'i' } }, { subject: { $regex: query.search, $options: 'i' } }];
    if (query.status) filter.status = query.status;
    const [items, total] = await Promise.all([Campaign.find(filter).sort({ createdAt: -1 }).skip((query.page - 1) * query.limit).limit(query.limit), Campaign.countDocuments(filter)]);
    res.json({ items, total, page: query.page, pages: Math.ceil(total / query.limit) });
  } catch (error) { next(error); }
});
router.post('/', async (req, res, next) => {
  try {
    const input = campaignInput.parse(req.body); validatePlaceholders(`${input.subject}\n${input.body}`);
    const user = (req as AuthRequest).user!;
    const campaign = await Campaign.create({ ...input, resumeLink: input.resumeLink || user.resumeLink || undefined, includeResumeLink: input.includeResumeLink ?? true, optOutEnabled: input.optOutEnabled ?? false, userId: user.id });
    res.status(201).json({ campaign });
  } catch (error) { next(error); }
});
router.post('/from-template/:templateId', async (req, res, next) => {
  try {
    const template = await Template.findById(objectId(req.params.templateId)); if (!template) throw notFound('Template not found');
    assertOwner(template.userId, (req as AuthRequest).user!.id);
    const body = z.object({ name: z.string().trim().min(1).max(100).optional() }).parse(req.body);
    const user = (req as AuthRequest).user!;
    const campaign = await Campaign.create({ name: body.name ?? template.name, subject: template.subject, body: template.body, resumeLink: template.resumeLink || user.resumeLink, includeResumeLink: true, optOutEnabled: false, userId: user.id });
    res.status(201).json({ campaign });
  } catch (error) { next(error); }
});
router.get('/:id', async (req, res, next) => {
  try { const campaign = await Campaign.findById(objectId(req.params.id)); if (!campaign) throw notFound('Campaign not found'); assertOwner(campaign.userId, (req as AuthRequest).user!.id); res.json({ campaign }); }
  catch (error) { next(error); }
});
router.get('/:id/export/recipients', exportRecipients);
router.get('/:id/export/report', exportReport);
router.patch('/:id', async (req, res, next) => {
  try {
    const campaign = await Campaign.findById(objectId(req.params.id)); if (!campaign) throw notFound('Campaign not found'); assertOwner(campaign.userId, (req as AuthRequest).user!.id);
    if (campaign.status !== 'draft') throw new AppError(409, 'Only draft campaigns can be edited', 'CAMPAIGN_NOT_EDITABLE');
    const input = campaignInput.partial().parse(req.body); if (input.subject || input.body) validatePlaceholders(`${input.subject ?? campaign.subject}\n${input.body ?? campaign.body}`);
    Object.assign(campaign, input); campaign.resumeLink = input.resumeLink || undefined; await campaign.save(); res.json({ campaign });
  } catch (error) { next(error); }
});
router.delete('/:id', async (req, res, next) => {
  try {
    const campaign = await Campaign.findById(objectId(req.params.id)); if (!campaign) throw notFound('Campaign not found'); assertOwner(campaign.userId, (req as AuthRequest).user!.id);
    if (['pending', 'sending'].includes(campaign.status)) throw new AppError(409, 'Running or queued campaigns cannot be deleted', 'CAMPAIGN_ACTIVE');
    await Promise.all([
      Recipient.deleteMany({ campaignId: campaign.id }),
      import('../models/EmailLog').then(({ EmailLog }) => EmailLog.deleteMany({ campaignId: campaign.id }))
    ]);
    await campaign.deleteOne(); res.status(204).send();
  }
  catch (error) { next(error); }
});
router.post('/:id/save-as-template', async (req, res, next) => {
  try {
    const campaign = await Campaign.findById(objectId(req.params.id)); if (!campaign) throw notFound('Campaign not found'); assertOwner(campaign.userId, (req as AuthRequest).user!.id);
    const input = z.object({ name: z.string().trim().min(1).max(100), isDefault: z.boolean().optional() }).parse(req.body);
    if (input.isDefault) await Template.updateMany({ userId: campaign.userId }, { $set: { isDefault: false } });
    const template = await Template.create({ userId: campaign.userId, name: input.name, subject: campaign.subject, body: campaign.body, resumeLink: campaign.resumeLink, isDefault: input.isDefault ?? false });
    res.status(201).json({ template });
  } catch (error) { next(error); }
});
router.post('/:id/launch', async (req, res, next) => {
  try {
    const campaign = await Campaign.findById(objectId(req.params.id)); if (!campaign) throw notFound('Campaign not found');
    assertOwner(campaign.userId, (req as AuthRequest).user!.id);
    const user = await User.findById((req as AuthRequest).user!.id).select('+gmail.refreshToken');
    if (!user?.gmail?.refreshToken) throw new AppError(400, 'Gmail is not connected', 'GMAIL_NOT_CONNECTED');
    if (!campaign.subject || !campaign.body) throw new AppError(400, 'Campaign subject and body are required', 'CAMPAIGN_INCOMPLETE');
    const pendingCount = await Recipient.countDocuments({ campaignId: campaign.id, status: 'pending', gmailMessageId: { $exists: false } });
    if (pendingCount === 0) throw new AppError(400, 'Campaign has no pending recipients', 'NO_PENDING_RECIPIENTS');
    const previousStatus = campaign.status;
    const previousPauseReason = campaign.pauseReason;
    campaign.status = 'pending'; campaign.pauseReason = undefined; await campaign.save();
    await Recipient.updateMany({ campaignId: campaign.id, status: { $in: ['failed'] } }, { $unset: { error: 1, errorCode: 1 } });
    try {
      await sendCampaign(campaign.id);
    } catch (error) {
      campaign.status = previousStatus;
      campaign.pauseReason = previousPauseReason;
      await campaign.save();
      throw error;
    }
    res.json({ campaign });
  } catch (error) { next(error); }
});
router.post('/:id/pause', async (req, res, next) => {
  try { const campaign = await Campaign.findById(objectId(req.params.id)); if (!campaign) throw notFound('Campaign not found'); assertOwner(campaign.userId, (req as AuthRequest).user!.id); campaign.status = 'paused'; await campaign.save(); res.json({ campaign }); }
  catch (error) { next(error); }
});
router.post('/:id/resume', async (req, res, next) => {
  try { const campaign = await Campaign.findById(objectId(req.params.id)); if (!campaign) throw notFound('Campaign not found'); assertOwner(campaign.userId, (req as AuthRequest).user!.id); campaign.status = 'pending'; campaign.pauseReason = undefined; await campaign.save(); await sendCampaign(campaign.id); res.json({ campaign }); }
  catch (error) { next(error); }
});
router.post('/:id/cancel', async (req, res, next) => {
  try { const campaign = await Campaign.findById(objectId(req.params.id)); if (!campaign) throw notFound('Campaign not found'); assertOwner(campaign.userId, (req as AuthRequest).user!.id); campaign.status = 'cancelled'; await campaign.save(); await Recipient.updateMany({ campaignId: campaign.id, status: 'pending' }, { $set: { status: 'skipped' } }); res.json({ campaign }); }
  catch (error) { next(error); }
});
router.post('/:id/retry-failed', async (req, res, next) => {
  try { const campaign = await Campaign.findById(objectId(req.params.id)); if (!campaign) throw notFound('Campaign not found'); assertOwner(campaign.userId, (req as AuthRequest).user!.id); await Recipient.updateMany({ campaignId: campaign.id, status: 'failed', gmailMessageId: { $exists: false }, errorCode: { $ne: 'PERMANENT' } }, { $set: { status: 'pending', attempts: 0 }, $unset: { error: 1, errorCode: 1 } }); campaign.status = 'pending'; campaign.pauseReason = undefined; await campaign.save(); await sendCampaign(campaign.id); res.json({ campaign }); }
  catch (error) { next(error); }
});
router.post('/:id/preview', async (req, res, next) => {
  try {
    const campaign = await Campaign.findById(objectId(req.params.id)); if (!campaign) throw notFound('Campaign not found'); assertOwner(campaign.userId, (req as AuthRequest).user!.id);
    const input = z.object({ recipientId: z.string().optional(), recipient: z.object({ name: z.string().optional(), email: z.string().email(), company: z.string().optional() }).optional() }).parse(req.body);
    let recipient = input.recipient;
    if (input.recipientId) { const found = await Recipient.findOne({ _id: objectId(input.recipientId), campaignId: campaign.id }); if (!found) throw notFound('Recipient not found'); recipient = { name: found.name, email: found.email, company: found.company }; }
    recipient ??= { name: 'Alex Morgan', email: 'alex@example.com', company: 'Example Company' };
    const user = (req as AuthRequest).user!;
    res.json(renderCampaign(campaign, recipient, user.name));
  } catch (error) { next(error); }
});

router.post('/:id/test-send', async (req, res, next) => {
  try {
    const campaign = await Campaign.findById(objectId(req.params.id));
    if (!campaign) throw notFound('Campaign not found');
    assertOwner(campaign.userId, (req as AuthRequest).user!.id);
    const user = await User.findById((req as AuthRequest).user!.id).select('+gmail.accessToken +gmail.refreshToken');
    if (!user?.gmail?.refreshToken) throw new AppError(400, 'Gmail is not connected', 'GMAIL_NOT_CONNECTED');
    const recipient = z.object({ email: z.string().email().optional() }).parse(req.body);
    const recipientEmail = recipient.email ?? user.gmail.email ?? user.email;
    const rendered = renderCampaign(campaign, { email: recipientEmail, name: user.name, company: 'Sample Company' }, user.name);
    const result = await sendOneEmail(user, recipientEmail, rendered.subject, rendered.html);
    res.json({ messageId: result.data.id });
  } catch (error) { next(error); }
});
export default router;

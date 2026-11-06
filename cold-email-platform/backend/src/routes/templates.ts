import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { Template } from '../models/Template';
import { AppError, notFound } from '../utils/errors';
import { assertOwner, objectId } from '../utils/ownership';
import { validatePlaceholders } from '../services/templateRenderer';

const schema = z.object({
  name: z.string().trim().min(1).max(100),
  subject: z.string().trim().min(1).max(998),
  body: z.string().trim().min(1).max(100000),
  resumeLink: z.string().url().max(2048).optional().or(z.literal('')),
  isDefault: z.boolean().optional()
});
const router = Router();
router.use(requireAuth);

router.get('/', async (req, res, next) => {
  try { const templates = await Template.find({ userId: (req as AuthRequest).user!.id }).sort({ name: 1 }); res.json({ items: templates }); }
  catch (error) { next(error); }
});
router.post('/', async (req, res, next) => {
  try {
    const input = schema.parse(req.body); validatePlaceholders(`${input.subject}\n${input.body}`);
    const userId = (req as AuthRequest).user!.id;
    if (input.isDefault) await Template.updateMany({ userId }, { $set: { isDefault: false } });
    const item = await Template.create({ ...input, resumeLink: input.resumeLink || undefined, userId });
    res.status(201).json({ template: item });
  } catch (error: any) { next(error?.code === 11000 ? new AppError(409, 'Template name already exists', 'DUPLICATE_TEMPLATE') : error); }
});
router.patch('/:id', async (req, res, next) => {
  try {
    const input = schema.partial().parse(req.body);
    if (input.subject || input.body) validatePlaceholders(`${input.subject ?? ''}\n${input.body ?? ''}`);
    const item = await Template.findById(objectId(req.params.id)); if (!item) throw notFound('Template not found');
    assertOwner(item.userId, (req as AuthRequest).user!.id);
    if (input.isDefault) await Template.updateMany({ userId: item.userId, _id: { $ne: item._id } }, { $set: { isDefault: false } });
    Object.assign(item, input); item.resumeLink = input.resumeLink || undefined; await item.save(); res.json({ template: item });
  } catch (error) { next(error); }
});
router.delete('/:id', async (req, res, next) => {
  try { const item = await Template.findById(objectId(req.params.id)); if (!item) throw notFound('Template not found'); assertOwner(item.userId, (req as AuthRequest).user!.id); await item.deleteOne(); res.status(204).send(); }
  catch (error) { next(error); }
});
export default router;

import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { AuthRequest } from '../middleware/auth';
import { Campaign } from '../models/Campaign';
import { User } from '../models/User';
import { AppError, notFound } from '../utils/errors';
import { assertOwner, objectId } from '../utils/ownership';
import { sendOneEmail } from '../services/sendGmail';
const router = Router();
router.use(requireAuth);

router.post('/:id/test-send', async (req, res, next) => {
  try {
    const campaign = await Campaign.findById(objectId(req.params.id));
    if (!campaign) throw notFound('Campaign not found');
    assertOwner(campaign.userId, (req as AuthRequest).user!.id);
    const user = await User.findById((req as AuthRequest).user!.id).select('+gmail.accessToken +gmail.refreshToken');
    if (!user?.gmail?.refreshToken) throw new AppError(400, 'Gmail is not connected', 'GMAIL_NOT_CONNECTED');
    const recipient = z.object({ email: z.string().email().optional() }).parse(req.body);
    const recipientEmail = recipient.email ?? user.gmail.email ?? user.email;
    const result = await sendOneEmail(user, recipientEmail, campaign.subject, String(campaign.body));
    res.json({ messageId: result.data.id });
  } catch (error) { next(error); }
});
export default router;

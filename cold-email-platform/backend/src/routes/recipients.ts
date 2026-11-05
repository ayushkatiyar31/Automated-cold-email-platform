import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { listRecipients, updateRecipient, deleteRecipient } from '../controllers/recipientController';
const router = Router();
router.use(requireAuth);
router.get('/', listRecipients);
router.patch('/:id', updateRecipient);
router.delete('/:id', deleteRecipient);
export default router;

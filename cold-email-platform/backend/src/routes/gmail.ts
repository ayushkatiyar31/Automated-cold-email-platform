import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { authUrl, callback, disconnect, status } from '../controllers/gmailController';
const router = Router();
router.get('/auth-url', requireAuth, authUrl);
router.get('/callback', callback);
router.get('/status', requireAuth, status);
router.post('/disconnect', requireAuth, disconnect);
export default router;

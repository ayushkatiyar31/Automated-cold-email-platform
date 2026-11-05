import { Router } from 'express';
import multer from 'multer';
import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { requireAuth } from '../middleware/auth';
import { uploadFile, uploadStatus, deleteUpload } from '../controllers/uploadController';

const tempDir = join(process.cwd(), 'uploads');
if (!existsSync(tempDir)) mkdirSync(tempDir, { recursive: true });
const upload = multer({ dest: tempDir, limits: { fileSize: 10 * 1024 * 1024, files: 1 } });
const router = Router();
router.use(requireAuth);
router.post('/', upload.single('file'), uploadFile);
router.get('/:id', uploadStatus);
router.delete('/:id', deleteUpload);
export default router;

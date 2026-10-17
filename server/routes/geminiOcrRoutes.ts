import { Router } from 'express';
import { GeminiOcrController } from '../controllers/GeminiOcrController';
import { authMiddleware } from '../middleware/auth';
import { geminiOcrRateLimiter } from '../middleware/rateLimiter';

const router = Router();
router.use(authMiddleware, geminiOcrRateLimiter);
router.post('/inventory', GeminiOcrController.extractInventory);
router.post('/menu', GeminiOcrController.extractMenu);

export default router;

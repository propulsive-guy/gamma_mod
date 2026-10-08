import { Router } from 'express';
import { authMiddleware } from '../middleware/auth';
import { InventoryController } from '../controllers/InventoryController';

const router = Router();
router.use(authMiddleware);
router.get('/', InventoryController.list);
router.post('/', InventoryController.create);
router.post('/bill-purchase', InventoryController.purchaseFromBill);
router.put('/:id', InventoryController.update);
router.post('/:id/adjust', InventoryController.adjust);
router.delete('/:id', InventoryController.archive);

export default router;

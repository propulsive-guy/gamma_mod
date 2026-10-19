import mongoose from 'mongoose';
import KitchenStockLot from '@/models/KitchenStockLot';
import KitchenStock from '@/models/KitchenStock';
import InventoryItem from '@/models/InventoryItem';
import StockMovement from '@/models/StockMovement';
import { expireDueKitchenLots, seedLegacyKitchenLots } from '../../shared/kitchenStockLots';

export async function processKitchenStockExpiry(restaurantId: mongoose.Types.ObjectId | string) {
    const session = await mongoose.startSession();
    let result = { expiredLots: 0, expiredQuantity: 0 };
    try {
        await session.withTransaction(async () => {
            await seedLegacyKitchenLots({ Lot: KitchenStockLot, KitchenStock, InventoryItem }, restaurantId, session);
            result = await expireDueKitchenLots({ Lot: KitchenStockLot, KitchenStock, StockMovement }, restaurantId, session);
        });
    } finally {
        await session.endSession();
    }
    return result;
}

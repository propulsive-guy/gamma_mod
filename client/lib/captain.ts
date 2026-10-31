import 'server-only';

import { randomBytes } from 'crypto';
import Restaurant from '@/models/Restaurant';

/** Create the restaurant's captain URL once and keep returning the same token. */
export async function getOrCreateCaptainToken(restaurantId: string) {
    const token = randomBytes(32).toString('hex');
    const created = await Restaurant.findOneAndUpdate(
        {
            _id: restaurantId,
            $or: [
                { captainToken: { $exists: false } },
                { captainToken: null },
                { captainToken: '' },
            ],
        },
        { $set: { captainToken: token } },
        { new: true },
    ).select('+captainToken').lean();

    if (created?.captainToken) return created.captainToken;

    const existing = await Restaurant.findById(restaurantId).select('+captainToken').lean();
    if (!existing) throw new Error('Restaurant not found while preparing its captain page.');
    if (existing.captainToken) return existing.captainToken;
    throw new Error('Could not prepare a permanent captain page URL.');
}

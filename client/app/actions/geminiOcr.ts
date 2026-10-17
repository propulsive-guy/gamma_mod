'use server';

import { auth } from '@/lib/auth';
import { apiFetch } from '@/lib/api';

type InventoryLine = { name: string; quantity: number; unit: string; unitCost: number; sourceText: string };
type MenuLine = { name: string; description: string; price: number; category: string };
type GeminiResult =
    | { success: true; lines: InventoryLine[] }
    | { success: true; items: MenuLine[] }
    | { success: false; error: string };

const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']);

async function extractOnApiServer(formData: FormData, task: 'inventory' | 'menu'): Promise<GeminiResult> {
    try {
        const session = await auth();
        if (!session?.user?.restaurantId) return { success: false, error: 'Please sign in again.' };

        const file = formData.get('image');
        if (!(file instanceof File) || !ALLOWED_IMAGE_TYPES.has(file.type.toLowerCase())) {
            return { success: false, error: 'Choose a JPG, PNG, WebP, or HEIC image.' };
        }
        if (!file.size || file.size > MAX_IMAGE_BYTES) {
            return { success: false, error: 'Prepared image must be 4 MB or smaller. Choose the photo again and retry.' };
        }

        // Gemini and its API key live on the Express/EC2 backend. Next only
        // forwards the authenticated image and returns the parsed suggestions.
        const imageBase64 = Buffer.from(await file.arrayBuffer()).toString('base64');
        const response = await apiFetch(`/api/v1/ocr/${task}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ imageBase64, mimeType: file.type.toLowerCase() }),
            signal: AbortSignal.timeout(58_000),
        });
        const result = await response.json().catch(() => ({})) as GeminiResult;
        if (!response.ok) return { success: false, error: 'error' in result && result.error ? result.error : `The API server returned HTTP ${response.status} while reading the image.` };
        return result;
    } catch (error) {
        const name = error instanceof Error ? error.name : '';
        if (name === 'TimeoutError' || name === 'AbortError') {
            return { success: false, error: 'The API server did not finish the image scan within 58 seconds. Please retry; if it repeats, check the EC2 server logs.' };
        }
        console.error('Gemini API-server proxy failed:', { name, message: error instanceof Error ? error.message : String(error) });
        return { success: false, error: 'Could not reach the image-reading API server. Check the connection and EC2 API status, then retry.' };
    }
}

export async function extractInventoryBill(formData: FormData): Promise<{ success: true; lines: InventoryLine[] } | { success: false; error: string }> {
    const result = await extractOnApiServer(formData, 'inventory');
    if (!result.success) return result;
    return 'lines' in result ? result : { success: false, error: 'The API returned the wrong response for a bill scan.' };
}

export async function extractMenuPhoto(formData: FormData): Promise<{ success: true; items: MenuLine[] } | { success: false; error: string }> {
    const result = await extractOnApiServer(formData, 'menu');
    if (!result.success) return result;
    return 'items' in result ? result : { success: false, error: 'The API returned the wrong response for a menu scan.' };
}

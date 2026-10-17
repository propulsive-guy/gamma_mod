'use server';

import { auth } from '@/lib/auth';
import { getCloudflareContext } from '@opennextjs/cloudflare';

type GeminiTask = 'inventory' | 'menu';
type InventoryLine = { name: string; quantity: number; unit: string; unitCost: number; sourceText: string };
type MenuLine = { name: string; description: string; price: number; category: string };

const MAX_IMAGE_BYTES = 9 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']);
const INVENTORY_UNITS = new Set(['kg', 'g', 'l', 'ml', 'piece', 'pack', 'box', 'bottle', 'can', '']);

function getGeminiApiKey() {
    try {
        const runtimeSecret = (getCloudflareContext().env as CloudflareEnv & { Gemini_bitbyte?: string }).Gemini_bitbyte;
        if (typeof runtimeSecret === 'string' && runtimeSecret.trim()) return runtimeSecret.trim();
    } catch {
        // Local Next.js development may not have a Cloudflare runtime context.
    }
    return process.env.Gemini_bitbyte?.trim();
}

function toBase64(bytes: Uint8Array) {
    let binary = '';
    const chunkSize = 0x8000;
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
    }
    return btoa(binary);
}

const inventorySchema = {
    type: 'OBJECT',
    properties: {
        lines: {
            type: 'ARRAY',
            items: {
                type: 'OBJECT',
                properties: {
                    name: { type: 'STRING' },
                    quantity: { type: 'NUMBER' },
                    unit: { type: 'STRING', enum: ['kg', 'g', 'l', 'ml', 'piece', 'pack', 'box', 'bottle', 'can', ''] },
                    unitCost: { type: 'NUMBER' },
                    sourceText: { type: 'STRING' },
                },
                required: ['name', 'quantity', 'unit', 'unitCost', 'sourceText'],
            },
        },
    },
    required: ['lines'],
};

const menuSchema = {
    type: 'OBJECT',
    properties: {
        items: {
            type: 'ARRAY',
            items: {
                type: 'OBJECT',
                properties: {
                    name: { type: 'STRING' },
                    description: { type: 'STRING' },
                    price: { type: 'NUMBER' },
                    category: { type: 'STRING' },
                },
                required: ['name', 'description', 'price', 'category'],
            },
        },
    },
    required: ['items'],
};

function validateInventoryLines(value: unknown): InventoryLine[] {
    if (!Array.isArray(value)) return [];
    return value.slice(0, 40).flatMap((line: any) => {
        const name = typeof line?.name === 'string' ? line.name.trim().slice(0, 120) : '';
        const quantity = line?.quantity === null || line?.quantity === undefined ? 0 : Number(line.quantity);
        const unitCost = line?.unitCost === null || line?.unitCost === undefined ? -1 : Number(line.unitCost);
        const unit = typeof line?.unit === 'string' && INVENTORY_UNITS.has(line.unit.toLowerCase()) ? line.unit.toLowerCase() : '';
        if (!name || !Number.isFinite(quantity) || quantity < 0 || quantity > 100000 || !Number.isFinite(unitCost) || unitCost < -1 || unitCost > 10000000) return [];
        return [{ name, quantity, unit, unitCost, sourceText: typeof line?.sourceText === 'string' ? line.sourceText.trim().slice(0, 240) : name }];
    });
}

function validateMenuItems(value: unknown): MenuLine[] {
    if (!Array.isArray(value)) return [];
    return value.slice(0, 100).flatMap((item: any) => {
        const name = typeof item?.name === 'string' ? item.name.trim().slice(0, 120) : '';
        const category = typeof item?.category === 'string' ? item.category.trim().slice(0, 80) : '';
        const description = typeof item?.description === 'string' ? item.description.trim().slice(0, 500) : '';
        const price = Number(item?.price);
        if (!name || !category || !Number.isFinite(price) || price < 0 || price > 100000) return [];
        return [{ name, category, description, price: Math.round(price * 100) / 100 }];
    });
}

async function extractWithGemini(formData: FormData, task: GeminiTask) {
    const session = await auth();
    if (!session?.user?.restaurantId) return { success: false as const, error: 'Please sign in again.' };

    const apiKey = getGeminiApiKey();
    if (!apiKey) {
        console.error('Gemini OCR is not configured: Gemini_bitbyte is missing');
        return { success: false as const, error: 'Image reading is not configured. Add the Gemini_bitbyte server secret.' };
    }
    const file = formData.get('image');
    if (!(file instanceof File) || !ALLOWED_IMAGE_TYPES.has(file.type.toLowerCase())) {
        return { success: false as const, error: 'Choose a JPG, PNG, WebP, or HEIC image.' };
    }
    if (file.size < 1 || file.size > MAX_IMAGE_BYTES) {
        return { success: false as const, error: 'Image must be smaller than 9MB.' };
    }

    const instructions = task === 'inventory'
        ? 'Extract purchased product rows from this supplier bill, including photographed, rotated, handwritten, or non-standard table layouts. Ignore totals, tax, discounts, and invoice metadata. Return a best-effort entry for every plausible product row. Normalize unit to kg, g, l, ml, piece, pack, box, bottle, or can; use empty string if uncertain. Return cost per unit; when only a line total is visible, divide it by quantity. Do not guess unreadable numbers: use 0 for unreadable quantity and -1 for unreadable unit cost so the user can fill them in. Preserve a short snippet in sourceText.'
        : 'Extract food and drink items from this restaurant menu, including rotated or non-standard layouts. Ignore headings without items, contact details, promotions, and tax notes. Return a best-effort entry for each plausible item. Use an empty description if none is printed and category Other if the section is unclear. Do not invent a price; use 0 if it is unreadable so the user can review it.';
    const schema = task === 'inventory' ? inventorySchema : menuSchema;

    try {
        const imageData = toBase64(new Uint8Array(await file.arrayBuffer()));
        const requestExtraction = async (prompt: string) => {
            const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
                body: JSON.stringify({
                    contents: [{
                        role: 'user',
                        parts: [
                            { text: prompt },
                            { inline_data: { mime_type: file.type.toLowerCase(), data: imageData } },
                        ],
                    }],
                    generationConfig: { responseMimeType: 'application/json', responseSchema: schema, temperature: 0, maxOutputTokens: 8192 },
                }),
                signal: AbortSignal.timeout(45_000),
            });
            if (!response.ok) {
                console.error('Gemini image extraction failed with status:', response.status);
                const error = response.status === 401 || response.status === 403
                    ? 'Gemini rejected the API key. Check the Gemini_bitbyte secret and that the key has Gemini API access.'
                    : response.status === 429
                        ? 'Gemini quota or rate limit reached. Check the API quota or try again later.'
                        : response.status === 400
                            ? 'Gemini rejected this image or request. Try a JPG or PNG photo; if that fails, check the Gemini API configuration.'
                            : response.status === 404
                                ? 'The configured Gemini model is unavailable for this API key.'
                                : `Gemini service error (${response.status}). Please try again shortly.`;
                return { error } as const;
            }
            const payload = await response.json();
            const text = payload?.candidates?.[0]?.content?.parts?.map((part: { text?: string }) => part.text || '').join('');
            if (typeof text !== 'string' || !text.trim()) {
                const reason = payload?.candidates?.[0]?.finishReason || payload?.promptFeedback?.blockReason;
                return { error: reason ? `Gemini could not process this image (${reason}).` : 'Gemini returned no readable result for this image.' } as const;
            }
            try { return { data: JSON.parse(text) as unknown } as const; }
            catch { return { error: 'Gemini returned an incomplete response. Try scanning the image again.' } as const; }
        };

        let extraction = await requestExtraction(instructions);
        if ('error' in extraction) return { success: false as const, error: extraction.error };

        const getRows = (data: unknown) => task === 'inventory'
            ? validateInventoryLines((data as { lines?: unknown })?.lines)
            : validateMenuItems((data as { items?: unknown })?.items);
        let rows = getRows(extraction.data);
        if (!rows.length) {
            extraction = await requestExtraction(`${instructions} This is a second-pass extraction. Look closely for text in table columns, faint print, and rows that wrap across lines. Return the required JSON arrays even if some individual numeric fields are uncertain; use the instructed sentinel values for unreadable fields.`);
            if ('error' in extraction) return { success: false as const, error: extraction.error };
            rows = getRows(extraction.data);
        }
        if (!rows.length) return { success: false as const, error: 'No bill or menu line items were recognized. Try a closer photo of the printed rows, or add the rows manually.' };
        return task === 'inventory'
            ? { success: true as const, lines: rows as InventoryLine[] }
            : { success: true as const, items: rows as MenuLine[] };
    } catch (error) {
        const name = error instanceof Error ? error.name : 'UnknownError';
        console.error('Gemini image extraction request failed:', { name, message: error instanceof Error ? error.message : String(error) });
        if (name === 'TimeoutError' || name === 'AbortError') {
            return { success: false as const, error: 'Gemini took too long to read this bill. Please try again.' };
        }
        return { success: false as const, error: 'The image reached the app, but Gemini could not complete the scan. Check the Cloudflare Worker logs for the underlying error.' };
    }
}

export async function extractInventoryBill(formData: FormData) {
    return extractWithGemini(formData, 'inventory');
}

export async function extractMenuPhoto(formData: FormData) {
    return extractWithGemini(formData, 'menu');
}

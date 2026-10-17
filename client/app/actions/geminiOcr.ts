'use server';

import { auth } from '@/lib/auth';

type GeminiTask = 'inventory' | 'menu';
type InventoryLine = { name: string; quantity: number; unit: string; unitCost: number; sourceText: string };
type MenuLine = { name: string; description: string; price: number; category: string };

const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const GEMINI_REQUEST_TIMEOUT_MS = 24_000;
const GEMINI_MODEL = 'gemini-3.8-flash';
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']);
const INVENTORY_UNITS = new Set(['kg', 'g', 'l', 'ml', 'piece', 'pack', 'box', 'bottle', 'can', '']);

function getGeminiApiKey() {
    // Gemini calls run in the Vercel-hosted Next.js server action. Keep the key
    // server-only and configure Gemini_bitbyte in Vercel project environment variables.
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
    type: 'object',
    properties: {
        lines: {
            type: 'array',
            items: {
                type: 'object',
                properties: {
                    name: { type: 'string' },
                    quantity: { type: 'number' },
                    unit: { type: 'string', enum: ['kg', 'g', 'l', 'ml', 'piece', 'pack', 'box', 'bottle', 'can', ''] },
                    unitCost: { type: 'number' },
                    sourceText: { type: 'string' },
                },
                required: ['name', 'quantity', 'unit', 'unitCost', 'sourceText'],
            },
        },
    },
    required: ['lines'],
};

const menuSchema = {
    type: 'object',
    properties: {
        items: {
            type: 'array',
            items: {
                type: 'object',
                properties: {
                    name: { type: 'string' },
                    description: { type: 'string' },
                    price: { type: 'number' },
                    category: { type: 'string' },
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
    try {
        const session = await auth();
        if (!session?.user?.restaurantId) return { success: false as const, error: 'Please sign in again.' };

        const apiKey = getGeminiApiKey();
        if (!apiKey) {
            console.error('Gemini OCR is not configured: Gemini_bitbyte is missing from the Vercel runtime');
            return { success: false as const, error: 'Gemini is not configured on Vercel. Add Gemini_bitbyte to the Production environment variables and redeploy.' };
        }
        const file = formData.get('image');
        if (!(file instanceof File) || !ALLOWED_IMAGE_TYPES.has(file.type.toLowerCase())) {
            return { success: false as const, error: 'Choose a JPG, PNG, WebP, or HEIC image.' };
        }
        if (file.size < 1 || file.size > MAX_IMAGE_BYTES) {
            return { success: false as const, error: 'The prepared image exceeds Vercel’s 4 MB upload limit. Please choose the photo again and retry.' };
        }

        const instructions = task === 'inventory'
            ? 'Extract purchased product rows from this supplier bill, including photographed, rotated, handwritten, or non-standard table layouts. Ignore totals, tax, discounts, and invoice metadata. Return a best-effort entry for every plausible product row. Normalize unit to kg, g, l, ml, piece, pack, box, bottle, or can; use empty string if uncertain. Return cost per unit; when only a line total is visible, divide it by quantity. Do not guess unreadable numbers: use 0 for unreadable quantity and -1 for unreadable unit cost so the user can fill them in. Preserve a short snippet in sourceText.'
            : 'Extract food and drink items from this restaurant menu, including rotated or non-standard layouts. Ignore headings without items, contact details, promotions, and tax notes. Return a best-effort entry for each plausible item. Use an empty description if none is printed and category Other if the section is unclear. Do not invent a price; use 0 if it is unreadable so the user can review it.';
        const schema = task === 'inventory' ? inventorySchema : menuSchema;

        const imageData = toBase64(new Uint8Array(await file.arrayBuffer()));
        const requestExtraction = async (prompt: string) => {
            const response = await fetch(GEMINI_ENDPOINT, {
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
                    generationConfig: {
                        // responseFormat.text.mimeType is a protobuf enum, not
                        // an HTTP MIME string. Gemini expects APPLICATION_JSON.
                        responseFormat: { text: { mimeType: 'APPLICATION_JSON', schema } },
                        thinkingConfig: { thinkingLevel: 'low' },
                        maxOutputTokens: 8192,
                    },
                }),
                // Keep room under the route's 60s Vercel function duration for
                // the optional second extraction pass and auth/database work.
                signal: AbortSignal.timeout(GEMINI_REQUEST_TIMEOUT_MS),
            });
            if (!response.ok) {
                let apiMessage = '';
                try {
                    const errorPayload = await response.json();
                    apiMessage = typeof errorPayload?.error?.message === 'string' ? errorPayload.error.message : '';
                } catch {
                    // Keep the HTTP status if Google's error response isn't JSON.
                }
                console.error('Gemini image extraction API error:', {
                    status: response.status,
                    model: GEMINI_MODEL,
                    mimeType: file.type,
                    imageBytes: file.size,
                    message: apiMessage.slice(0, 500),
                });
                const detail = apiMessage ? ` ${apiMessage.slice(0, 220)}` : '';
                const error = response.status === 401 || response.status === 403
                    ? `Gemini denied this API key or model access (${response.status}). Confirm Gemini_bitbyte is a valid Gemini API key in Vercel.${detail}`
                    : response.status === 429
                        ? `Gemini quota or rate limit reached (429). Check the API quota or try again later.${detail}`
                        : response.status === 400
                            ? `Gemini rejected the request (400).${detail}`
                            : response.status === 404
                                ? `Gemini model ${GEMINI_MODEL} was not found or is unavailable to this key.${detail}`
                                : `Gemini returned HTTP ${response.status}.${detail}`;
                return { error } as const;
            }
            const payload = await response.json();
            const candidate = payload?.candidates?.[0];
            const parts = candidate?.content?.parts;
            // Gemini 3 may include separate internal-thought parts; parse only
            // the user-facing response text so it remains valid JSON.
            const text = Array.isArray(parts)
                ? parts.filter((part: { thought?: boolean }) => part?.thought !== true).map((part: { text?: string }) => part.text || '').join('').trim()
                : '';
            if (typeof text !== 'string' || !text.trim()) {
                const reason = candidate?.finishReason || payload?.promptFeedback?.blockReason;
                return { error: reason ? `Gemini could not process this image (${reason}).` : 'Gemini returned no readable result for this image.' } as const;
            }
            try {
                const jsonText = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
                return { data: JSON.parse(jsonText) as unknown } as const;
            } catch {
                const reason = candidate?.finishReason;
                const suffix = reason ? ` (${reason})` : '';
                return { error: `Gemini returned an incomplete or invalid JSON response${suffix}. Try scanning again.` } as const;
            }
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
            return { success: false as const, error: 'Gemini timed out while reading the image. Try again; if it repeats, check the Vercel function duration and logs.' };
        }
        if (error instanceof TypeError && /fetch|network/i.test(error.message)) {
            return { success: false as const, error: 'Vercel could not reach the Gemini API. Check the Vercel Function logs and retry.' };
        }
        return { success: false as const, error: 'The scan failed inside the Vercel server action. Check the Vercel Function logs for the request error.' };
    }
}

export async function extractInventoryBill(formData: FormData) {
    return extractWithGemini(formData, 'inventory');
}

export async function extractMenuPhoto(formData: FormData) {
    return extractWithGemini(formData, 'menu');
}

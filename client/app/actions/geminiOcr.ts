'use server';

import { auth } from '@/lib/auth';

type GeminiTask = 'inventory' | 'menu';
type InventoryLine = { name: string; quantity: number; unit: string; unitCost: number; sourceText: string };
type MenuLine = { name: string; description: string; price: number; category: string };

const MAX_IMAGE_BYTES = 9 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']);
const INVENTORY_UNITS = new Set(['kg', 'g', 'l', 'ml', 'piece', 'pack', 'box', 'bottle', 'can', '']);

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
        const quantity = Number(line?.quantity);
        const unitCost = Number(line?.unitCost);
        const unit = typeof line?.unit === 'string' && INVENTORY_UNITS.has(line.unit.toLowerCase()) ? line.unit.toLowerCase() : '';
        if (!name || !Number.isFinite(quantity) || quantity <= 0 || quantity > 100000 || !Number.isFinite(unitCost) || unitCost < 0 || unitCost > 10000000) return [];
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

    const apiKey = process.env.Gemini_bitbyte;
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
        ? 'Read this supplier purchase bill and extract only purchased inventory line items. Ignore totals, taxes, discounts, invoice metadata and payment details. Return each line name, purchased quantity, unit (normalize to kg, g, l, ml, piece, pack, box, bottle, or can; use empty string if not clear), cost per unit (not line total), and a short sourceText from the bill. Do not invent unclear values; skip rows that do not clearly identify an item and quantity.'
        : 'Read this restaurant menu and extract only food and drink menu items. Ignore headings without items, contact details, promotions, and tax notes. Return each item name, short description if visible (otherwise empty string), listed price as a number, and category based on the nearest printed section heading (or Other). Do not invent prices; skip rows without a clear item name and price.';
    const schema = task === 'inventory' ? inventorySchema : menuSchema;

    try {
        const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
            body: JSON.stringify({
                contents: [{
                    role: 'user',
                    parts: [
                        { text: instructions },
                        { inline_data: { mime_type: file.type.toLowerCase(), data: toBase64(new Uint8Array(await file.arrayBuffer())) } },
                    ],
                }],
                generationConfig: { responseMimeType: 'application/json', responseSchema: schema, temperature: 0 },
            }),
        });

        if (!response.ok) {
            console.error('Gemini image extraction failed with status:', response.status);
            return { success: false as const, error: response.status === 429 ? 'Gemini is busy. Please try again shortly.' : 'Gemini could not read this image. Try a clearer photo.' };
        }
        const payload = await response.json();
        const text = payload?.candidates?.[0]?.content?.parts?.map((part: { text?: string }) => part.text || '').join('');
        if (typeof text !== 'string' || !text.trim()) return { success: false as const, error: 'Gemini did not find readable rows in this image.' };

        let parsed: unknown;
        try { parsed = JSON.parse(text); }
        catch {
            console.error('Gemini returned invalid structured JSON');
            return { success: false as const, error: 'Gemini returned unreadable results. Please try again.' };
        }

        if (task === 'inventory') {
            const lines = validateInventoryLines((parsed as { lines?: unknown })?.lines);
            return lines.length
                ? { success: true as const, lines }
                : { success: false as const, error: 'No clear inventory item rows were found. Try a straighter, brighter photo.' };
        }
        const items = validateMenuItems((parsed as { items?: unknown })?.items);
        return items.length
            ? { success: true as const, items }
            : { success: false as const, error: 'No clear menu item and price rows were found. Try a straighter, brighter photo.' };
    } catch (error) {
        console.error('Gemini image extraction request failed:', error);
        return { success: false as const, error: 'Could not contact Gemini. Check the server configuration and try again.' };
    }
}

export async function extractInventoryBill(formData: FormData) {
    return extractWithGemini(formData, 'inventory');
}

export async function extractMenuPhoto(formData: FormData) {
    return extractWithGemini(formData, 'menu');
}

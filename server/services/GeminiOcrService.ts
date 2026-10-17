type GeminiTask = 'inventory' | 'menu';
type InventoryLine = { name: string; quantity: number; unit: string; unitCost: number; sourceText: string };
type MenuLine = { name: string; description: string; price: number; category: string };
type ExtractionResult =
    | { success: true; lines: InventoryLine[] }
    | { success: true; items: MenuLine[] }
    | { success: false; error: string };

const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const SCAN_BUDGET_MS = 55_000;
const GEMINI_MODEL = 'gemini-3.8-flash';
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']);
const INVENTORY_UNITS = new Set(['kg', 'g', 'l', 'ml', 'piece', 'pack', 'box', 'bottle', 'can', '']);

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
        const quantity = line?.quantity == null ? 0 : Number(line.quantity);
        const unitCost = line?.unitCost == null ? -1 : Number(line.unitCost);
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

function errorMessage(status: number, message: string) {
    const detail = message ? ` ${message.slice(0, 220)}` : '';
    if (status === 401 || status === 403) return `Gemini denied this API key or model access (${status}). Check the Gemini_bitbyte secret on the server.${detail}`;
    if (status === 429) return `Gemini quota or rate limit reached (429). Check the API quota or try again later.${detail}`;
    if (status === 400) return `Gemini rejected the request (400).${detail}`;
    if (status === 404) return `Gemini model ${GEMINI_MODEL} was not found or is unavailable to this key.${detail}`;
    return `Gemini returned HTTP ${status}.${detail}`;
}

export async function extractWithGemini(task: GeminiTask, image: Buffer, mimeType: string): Promise<ExtractionResult> {
    const apiKey = process.env.Gemini_bitbyte?.trim();
    if (!apiKey) {
        console.error('Gemini OCR is not configured: Gemini_bitbyte is missing from the EC2 server environment');
        return { success: false, error: 'Gemini bill reading is not configured on the API server. Add the Gemini_bitbyte secret to the EC2 environment and restart the API.' };
    }
    const mime = mimeType.toLowerCase();
    if (!ALLOWED_IMAGE_TYPES.has(mime)) return { success: false, error: 'Choose a JPG, PNG, WebP, or HEIC image.' };
    if (!image.length || image.length > MAX_IMAGE_BYTES) return { success: false, error: 'Prepared image must be 4 MB or smaller. Choose the photo again and retry.' };

    const instructions = task === 'inventory'
        ? 'Extract purchased product rows from this supplier bill, including photographed, rotated, handwritten, or non-standard table layouts. Ignore totals, tax, discounts, and invoice metadata. Return a best-effort entry for every plausible product row. Normalize unit to kg, g, l, ml, piece, pack, box, bottle, or can; use empty string if uncertain. Return cost per unit; when only a line total is visible, divide it by quantity. Do not guess unreadable numbers: use 0 for unreadable quantity and -1 for unreadable unit cost so the user can fill them in. Preserve a short snippet in sourceText.'
        : 'Extract food and drink items from this restaurant menu, including rotated or non-standard layouts. Ignore headings without items, contact details, promotions, and tax notes. Return a best-effort entry for each plausible item. Use an empty description if none is printed and category Other if the section is unclear. Do not invent a price; use 0 if it is unreadable so the user can review it.';
    const schema = task === 'inventory' ? inventorySchema : menuSchema;
    const imageData = image.toString('base64');
    const deadline = Date.now() + SCAN_BUDGET_MS;

    const requestExtraction = async (prompt: string): Promise<{ data: unknown } | { error: string }> => {
        const remainingMs = deadline - Date.now();
        if (remainingMs <= 0) return { error: 'The scan reached its server time limit before Gemini finished. Please try again.' };
        let response: Response;
        try {
            response = await fetch(GEMINI_ENDPOINT, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
                body: JSON.stringify({
                    contents: [{ role: 'user', parts: [{ text: prompt }, { inline_data: { mime_type: mime, data: imageData } }] }],
                    generationConfig: {
                        responseFormat: { text: { mimeType: 'APPLICATION_JSON', schema } },
                        thinkingConfig: { thinkingLevel: 'low' },
                        maxOutputTokens: 8192,
                    },
                }),
                signal: AbortSignal.timeout(remainingMs),
            });
        } catch (error) {
            const name = error instanceof Error ? error.name : '';
            if (name === 'TimeoutError' || name === 'AbortError') return { error: 'Gemini did not finish within the 55-second server scan window. Please try again.' };
            console.error('Gemini API request failed:', { name, message: error instanceof Error ? error.message : String(error) });
            return { error: 'The API server could not reach Gemini. Check the server logs and retry.' };
        }

        if (!response.ok) {
            let message = '';
            try {
                const payload: any = await response.json();
                message = typeof payload?.error?.message === 'string' ? payload.error.message : '';
            } catch { /* use the status code when the error response is not JSON */ }
            console.error('Gemini image extraction API error:', { status: response.status, model: GEMINI_MODEL, mimeType: mime, imageBytes: image.length, message: message.slice(0, 500) });
            return { error: errorMessage(response.status, message) };
        }

        try {
            const payload: any = await response.json();
            const candidate = payload?.candidates?.[0];
            const parts = candidate?.content?.parts;
            const text = Array.isArray(parts)
                ? parts.filter((part: { thought?: boolean }) => part?.thought !== true).map((part: { text?: string }) => part.text || '').join('').trim()
                : '';
            if (!text) {
                const reason = candidate?.finishReason || payload?.promptFeedback?.blockReason;
                return { error: reason ? `Gemini could not process this image (${reason}).` : 'Gemini returned no readable result for this image.' };
            }
            const jsonText = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
            return { data: JSON.parse(jsonText) as unknown };
        } catch {
            return { error: 'Gemini returned an incomplete or invalid JSON response. Try scanning again.' };
        }
    };

    const getRows = (data: unknown) => task === 'inventory'
        ? validateInventoryLines((data as { lines?: unknown })?.lines)
        : validateMenuItems((data as { items?: unknown })?.items);

    let extraction = await requestExtraction(instructions);
    if ('error' in extraction) return { success: false, error: extraction.error };
    let rows = getRows(extraction.data);
    if (!rows.length) {
        extraction = await requestExtraction(`${instructions} This is a second-pass extraction. Look closely for text in table columns, faint print, and rows that wrap across lines. Return the required JSON arrays even if some individual numeric fields are uncertain; use the instructed sentinel values for unreadable fields.`);
        if ('error' in extraction) return { success: false, error: extraction.error };
        rows = getRows(extraction.data);
    }
    if (!rows.length) return { success: false, error: 'No bill or menu line items were recognized. Try a closer photo of the printed rows, or add the rows manually.' };
    return task === 'inventory'
        ? { success: true, lines: rows as InventoryLine[] }
        : { success: true, items: rows as MenuLine[] };
}

export function decodeImagePayload(value: unknown) {
    if (typeof value !== 'string' || !value || value.length > Math.ceil(MAX_IMAGE_BYTES * 4 / 3) + 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return null;
    const image = Buffer.from(value, 'base64');
    if (!image.length || image.length > MAX_IMAGE_BYTES || image.toString('base64') !== value) return null;
    return image;
}

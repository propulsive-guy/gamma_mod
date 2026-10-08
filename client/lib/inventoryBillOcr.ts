export type ParsedBillLine = {
    name: string;
    quantity: number;
    unit: string;
    unitCost: number;
    sourceText: string;
};

const ignoredLine = /\b(invoice|bill no|invoice no|gstin|gst no|subtotal|sub total|grand total|total|cgst|sgst|igst|tax|discount|amount due|balance|date|phone|total qty|page)\b/i;
const numberPattern = /\d[\d,]*(?:\.\d+)?/g;
const unitPattern = /\b(kg|kgs|kilograms?|g|gm|gms|grams?|l|ltr|litres?|liters?|ml|millilitres?|milliliters?|pcs?|pieces?|pack|packs|box|boxes|bottle|bottles|can|cans)\b/i;

const unitMap: Record<string, string> = {
    kg: 'kg', kgs: 'kg', kilogram: 'kg', kilograms: 'kg',
    g: 'g', gm: 'g', gms: 'g', gram: 'g', grams: 'g',
    l: 'l', ltr: 'l', litre: 'l', litres: 'l', liter: 'l', liters: 'l',
    ml: 'ml', millilitre: 'ml', millilitres: 'ml', milliliter: 'ml', milliliters: 'ml',
    pc: 'piece', pcs: 'piece', piece: 'piece', pieces: 'piece',
    pack: 'pack', packs: 'pack', box: 'box', boxes: 'box',
    bottle: 'bottle', bottles: 'bottle', can: 'can', cans: 'can',
};

function numericValue(value: string) {
    return Number(value.replace(/,/g, ''));
}

export function parseInventoryBillText(text: string): ParsedBillLine[] {
    const parsed: ParsedBillLine[] = [];
    const seen = new Set<string>();

    for (const rawLine of text.split(/\r?\n/)) {
        const line = rawLine.replace(/[|]/g, ' ').replace(/\s+/g, ' ').trim();
        if (line.length < 5 || ignoredLine.test(line)) continue;

        const matches = [...line.matchAll(numberPattern)];
        if (matches.length < 3) continue;
        const quantityMatch = matches[matches.length - 3];
        const rateMatch = matches[matches.length - 2];
        const quantity = numericValue(quantityMatch[0]);
        const unitCost = numericValue(rateMatch[0]);
        if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 100000 || !Number.isFinite(unitCost) || unitCost < 0 || unitCost > 10000000) continue;

        const name = line.slice(0, quantityMatch.index).replace(/^\s*\d+[.)-]?\s*/, '').replace(/[\s:.,-]+$/, '').trim();
        if (name.length < 2) continue;
        const unitText = line.slice(quantityMatch.index! + quantityMatch[0].length, rateMatch.index).match(unitPattern)?.[0]?.toLowerCase();
        const unit = unitText ? unitMap[unitText] || '' : '';
        const key = `${name.toLowerCase()}|${quantity}|${unitCost}`;
        if (seen.has(key)) continue;
        seen.add(key);
        parsed.push({ name: name.slice(0, 120), quantity, unit, unitCost, sourceText: line.slice(0, 240) });
    }

    return parsed.slice(0, 40);
}

export const MIS_EXPENSE_CATEGORIES = [
    'Vegetables',
    'Grocery',
    'Bread & dairy',
    'Housekeeping / laundry',
    'Meat / seafood',
    'Ready-made items',
    'Non-consumables / disposables',
    'Consumables / beverages',
    'Fuel / charcoal',
    'Maintenance',
    'Salary',
    'Rent, taxes & compliance',
    'Staff welfare',
    'Capital',
    'Carting & transportation',
    'Miscellaneous',
] as const;

export const MIS_EXTERNAL_SALES_CHANNELS = ['Party Sale', 'Zomato'] as const;

export function canonicalMisExpenseCategory(value: string) {
    const category = String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    if (/vegetable|veg/.test(category)) return 'Vegetables';
    if (/grocery|grocer/.test(category)) return 'Grocery';
    if (/bread|dairy|milk/.test(category)) return 'Bread & dairy';
    if (/house.?keep|clean|laundry|garbage|garbej/.test(category)) return 'Housekeeping / laundry';
    if (/meat|chicken|mutton|fish|prawn|seafood/.test(category)) return 'Meat / seafood';
    if (/ready.?made|momo|coffee material/.test(category)) return 'Ready-made items';
    if (/dispos|non.?consum|tissue|cutlery/.test(category)) return 'Non-consumables / disposables';
    if (/consum|beverage|cold.?drink|water/.test(category)) return 'Consumables / beverages';
    if (/fuel|gas|charcoal/.test(category)) return 'Fuel / charcoal';
    if (/maint|repair/.test(category)) return 'Maintenance';
    if (/salary|wage|manpower|staff payment|advance/.test(category)) return 'Salary';
    if (/rent|tax|compliance|electricity|utility|utilities|vat/.test(category)) return 'Rent, taxes & compliance';
    if (/staff welfare|medical|promotion|tip/.test(category)) return 'Staff welfare';
    if (/capital|machine|equipment|asset/.test(category)) return 'Capital';
    if (/cart|transport|freight|delivery/.test(category)) return 'Carting & transportation';
    return 'Miscellaneous';
}

export function canonicalExternalSalesChannel(value: string) {
    const channel = String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    if (channel === 'party' || channel.includes('party sale')) return 'Party Sale';
    if (channel.includes('zomato') || channel.includes('swiggy') || channel === 'online sale') return 'Zomato';
    return null;
}

'use client';

import { useState, useEffect } from 'react';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import { createMenuItem, deleteMenuItem, toggleMenuItemAvailability, updateMenuItem } from '@/app/actions/menu';
import { toast } from 'react-hot-toast';
import { PlusIcon, TrashIcon, PencilIcon } from '@heroicons/react/24/outline';
import { MenuPhotoImporter } from './MenuPhotoImporter';
import Link from 'next/link';

interface MenuItem {
    _id: string;
    name: string;
    description: string;
    price: number;
    category: string;
    imageUrl?: string;
    aestheticImageUrl?: string;
    isAvailable: boolean;
    dietaryType?: 'veg' | 'non-veg' | 'vegan' | 'egg' | 'unknown';
    itemType?: 'food' | 'beverage' | 'water' | 'other';
    departmentId?: string;
    recipe?: { inventoryItemId: string; quantity: number }[];
}

interface InventoryOption { _id: string; name: string; unit: string; currentStock: number }
interface DepartmentOption { _id: string; name: string }

const recipeInputUnit = (stockUnit: string) => stockUnit === 'kg' ? 'g' : stockUnit === 'l' ? 'ml' : stockUnit;
const recipeInputScale = (stockUnit: string) => stockUnit === 'kg' || stockUnit === 'l' ? 1000 : 1;
const displayRecipeQuantity = (quantity: number, stockUnit: string) => {
    const value = quantity * recipeInputScale(stockUnit);
    return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(3)));
};

export function MenuList({ initialMenuItems, inventoryItems, departments }: { initialMenuItems: MenuItem[]; inventoryItems: InventoryOption[]; departments: DepartmentOption[] }) {
    const [showAddForm, setShowAddForm] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [recipe, setRecipe] = useState<{ inventoryItemId: string; quantity: number }[]>([]);
    const [formData, setFormData] = useState({
        name: '',
        description: '',
        price: '',
        category: '',
        imageUrl: '',
        aestheticImageUrl: '',
        dietaryType: 'unknown',
        itemType: 'food',
        departmentId: '',
    });
    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const [imagePreview, setImagePreview] = useState<string | null>(null);
    const [selectedAestheticFile, setSelectedAestheticFile] = useState<File | null>(null);
    const [aestheticImagePreview, setAestheticImagePreview] = useState<string | null>(null);
    const [selectedCategory, setSelectedCategory] = useState<string>('All');
    const maxUploadSize = 5 * 1024 * 1024;

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            if (file.size > maxUploadSize) {
                toast.error('Item image must be 5MB or smaller');
                e.target.value = '';
                return;
            }
            setSelectedFile(file);
            const reader = new FileReader();
            reader.onloadend = () => {
                setImagePreview(reader.result as string);
            };
            reader.readAsDataURL(file);
        }
    };

    const handleAestheticFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            if (file.size > maxUploadSize) {
                toast.error('Aesthetic image must be 5MB or smaller');
                e.target.value = '';
                return;
            }
            setSelectedAestheticFile(file);
            const reader = new FileReader();
            reader.onloadend = () => {
                setAestheticImagePreview(reader.result as string);
            };
            reader.readAsDataURL(file);
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsSubmitting(true);

        try {
            let finalImageUrl = formData.imageUrl;
            let finalAestheticImageUrl = formData.aestheticImageUrl;

            // Dynamically import to avoid server-side issues in some setups, though this is a client component
            const { uploadFile } = await import('@/app/actions/upload');

            if (selectedFile) {
                const uploadFormData = new FormData();
                uploadFormData.append('file', selectedFile);
                const uploadResult = await uploadFile(uploadFormData);

                if (uploadResult.success && uploadResult.url) {
                    finalImageUrl = uploadResult.url;
                } else {
                    toast.error(uploadResult.error || 'Failed to upload image');
                    setIsSubmitting(false);
                    return;
                }
            }

            if (selectedAestheticFile) {
                const uploadFormData = new FormData();
                uploadFormData.append('file', selectedAestheticFile);
                const uploadResult = await uploadFile(uploadFormData);

                if (uploadResult.success && uploadResult.url) {
                    finalAestheticImageUrl = uploadResult.url;
                } else {
                    toast.error(uploadResult.error || 'Failed to upload aesthetic image');
                    setIsSubmitting(false);
                    return;
                }
            }

            let result;
            if (editingId) {
                result = await updateMenuItem(editingId, {
                    ...formData,
                    imageUrl: finalImageUrl,
                    aestheticImageUrl: finalAestheticImageUrl,
                    price: parseFloat(formData.price),
                    recipe,
                });
            } else {
                result = await createMenuItem({
                    ...formData,
                    imageUrl: finalImageUrl,
                    aestheticImageUrl: finalAestheticImageUrl,
                    price: parseFloat(formData.price),
                    recipe,
                });
            }

            if (result.success) {
                toast.success(editingId ? 'Menu item updated successfully!' : 'Menu item added successfully!');
                setFormData({ name: '', description: '', price: '', category: '', imageUrl: '', aestheticImageUrl: '', dietaryType: 'unknown', itemType: 'food', departmentId: '' });
                setRecipe([]);
                setSelectedFile(null);
                setImagePreview(null);
                setSelectedAestheticFile(null);
                setAestheticImagePreview(null);
                setEditingId(null);
                setShowAddForm(false);
            } else {
                toast.error(result.error || (editingId ? 'Failed to update menu item' : 'Failed to add menu item'));
            }
        } catch (error) {
            console.error(error); // Log error for debugging
            toast.error('An error occurred');
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleEdit = (item: MenuItem) => {
        setEditingId(item._id);
        setRecipe(item.recipe || []);
        setFormData({
            name: item.name,
            description: item.description,
            price: item.price.toString(),
            category: item.category,
            imageUrl: item.imageUrl || '',
            aestheticImageUrl: item.aestheticImageUrl || '',
            dietaryType: item.dietaryType || 'unknown',
            itemType: item.itemType || 'food',
            departmentId: item.departmentId || '',
        });
        setImagePreview(item.imageUrl || null);
        setAestheticImagePreview(item.aestheticImageUrl || null);
        setSelectedFile(null);
        setSelectedAestheticFile(null);
        setShowAddForm(true);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const handleToggleAvailability = async (id: string) => {
        const result = await toggleMenuItemAvailability(id);
        if (result.success) {
            toast.success('Availability updated');
        } else {
            toast.error('Failed to update availability');
        }
    };

    const handleDelete = async (id: string) => {
        if (!confirm('Are you sure you want to delete this item?')) return;

        const result = await deleteMenuItem(id);
        if (result.success) {
            toast.success('Item deleted successfully');
        } else {
            toast.error('Failed to delete item');
        }
    };

    // Group items by category (case-insensitive & normalized to Title Case)
    const groupedItems = initialMenuItems.reduce((acc, item) => {
        const displayCategory = item.category
            .trim()
            .split(/\s+/)
            .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
            .join(' ');

        if (!acc[displayCategory]) {
            acc[displayCategory] = [];
        }
        acc[displayCategory].push(item);
        return acc;
    }, {} as Record<string, MenuItem[]>);

    const categories = ['All', ...Object.keys(groupedItems).sort()];

    // Reset selectedCategory to 'All' if it's no longer present in the category list
    useEffect(() => {
        if (!categories.includes(selectedCategory)) {
            setSelectedCategory('All');
        }
    }, [categories, selectedCategory]);

    const getCategoryCount = (category: string) => {
        if (category === 'All') {
            return initialMenuItems.length;
        }
        return groupedItems[category]?.length || 0;
    };

    const filteredGroupedItems = Object.entries(groupedItems).filter(([category]) =>
        selectedCategory === 'All' ? true : category === selectedCategory
    );
    const linkedMenuItems = initialMenuItems.filter((item) => item.departmentId && item.recipe?.length && item.recipe.every((part) => inventoryItems.some((inventoryItem) => inventoryItem._id === part.inventoryItemId)));
    const unlinkedMenuItems = initialMenuItems.filter((item) => !item.departmentId || !item.recipe?.length || !item.recipe.every((part) => inventoryItems.some((inventoryItem) => inventoryItem._id === part.inventoryItemId)));

    return (
        <div className="space-y-8">
            <MenuPhotoImporter />
            <section className="flex flex-col gap-4 rounded-2xl border border-sky-200 bg-sky-50 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
                <div>
                    <h2 className="font-bold text-slate-900">Automatic inventory deduction</h2>
                    <p className="mt-1 max-w-3xl text-sm text-slate-600">Assign each dish to the department that prepares it and add its ingredients per serving. Stock is reserved from that department when an order is placed and returned if the order is cancelled.</p>
                    <p className="mt-2 text-xs font-semibold text-slate-700">{linkedMenuItems.length} of {initialMenuItems.length} menu items linked · {unlinkedMenuItems.length} still need setup</p>
                </div>
                {unlinkedMenuItems.length > 0 && !showAddForm && (
                    <button type="button" onClick={() => handleEdit(unlinkedMenuItems[0])} className="min-h-11 shrink-0 rounded-xl bg-sky-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-sky-700">Set up next dish: {unlinkedMenuItems[0].name}</button>
                )}
                {!inventoryItems.length && <Link href="/dashboard/inventory" className="min-h-11 shrink-0 rounded-xl border border-sky-300 bg-white px-4 py-2.5 text-center text-sm font-bold text-sky-700 hover:bg-sky-100">Add stock items first</Link>}
            </section>
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white p-4 rounded-2xl border border-gray-100 shadow-sm animate-in fade-in duration-300">
                <div className="flex flex-wrap gap-2 max-w-full overflow-x-auto no-scrollbar py-1">
                    {categories.map((category) => (
                        <button
                            key={category}
                            onClick={() => setSelectedCategory(category)}
                            className={`px-4 py-2 rounded-xl text-sm font-semibold whitespace-nowrap transition-all duration-200 cursor-pointer flex items-center gap-2 ${
                                selectedCategory === category
                                    ? 'bg-sky-400 text-white shadow-md shadow-sky-400/20 scale-105'
                                    : 'bg-gray-50 text-gray-600 hover:bg-gray-100 border border-gray-100 hover:scale-102'
                            }`}
                        >
                            {category}
                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium transition-colors ${
                                selectedCategory === category
                                    ? 'bg-white/20 text-white'
                                    : 'bg-gray-200 text-gray-500'
                            }`}>
                                {getCategoryCount(category)}
                            </span>
                        </button>
                    ))}
                </div>
                <Button
                    onClick={() => {
                        if (showAddForm && editingId) {
                            setEditingId(null);
                            setRecipe([]);
                            setFormData({ name: '', description: '', price: '', category: '', imageUrl: '', aestheticImageUrl: '', dietaryType: 'unknown', itemType: 'food', departmentId: '' });
                            setImagePreview(null);
                            setSelectedFile(null);
                            setSelectedAestheticFile(null);
                            setAestheticImagePreview(null);
                        } else {
                            setShowAddForm(!showAddForm);
                            if (!showAddForm) {
                                setEditingId(null);
                                setRecipe([]);
                                setFormData({ name: '', description: '', price: '', category: '', imageUrl: '', aestheticImageUrl: '', dietaryType: 'unknown', itemType: 'food', departmentId: '' });
                                setImagePreview(null);
                                setSelectedFile(null);
                                setSelectedAestheticFile(null);
                                setAestheticImagePreview(null);
                            }
                        }
                    }}
                    className="flex items-center gap-2 bg-sky-400 hover:bg-sky-500 text-white shadow-lg shadow-sky-400/20 transition-all hover:-translate-y-0.5 whitespace-nowrap cursor-pointer"
                >
                    <PlusIcon className="h-5 w-5" />
                    Add Menu Item
                </Button>
            </div>

            {showAddForm && (
                <div className="bg-white border border-gray-100 rounded-2xl shadow-xl p-8 animate-in fade-in slide-in-from-top-4">
                    <h2 className="text-xl font-bold mb-6 text-gray-900 font-display">
                        {editingId ? 'Edit Menu Item' : 'Add New Item'}
                    </h2>
                    <form onSubmit={handleSubmit} className="space-y-6">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <Input
                                label="Item Name"
                                value={formData.name}
                                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                required
                                className="bg-sky-50 border-sky-100 text-gray-900 placeholder:text-gray-400 focus:ring-sky-500 focus:border-sky-500"
                            />
                            <Input
                                label="Price (₹)"
                                type="number"
                                step="0.01"
                                value={formData.price}
                                onChange={(e) => setFormData({ ...formData, price: e.target.value })}
                                required
                                className="bg-sky-50 border-sky-100 text-gray-900 placeholder:text-gray-400 focus:ring-sky-500 focus:border-sky-500"
                            />
                        </div>

                        <Input
                            label="Description"
                            value={formData.description}
                            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                            className="bg-sky-50 border-sky-100 text-gray-900 placeholder:text-gray-400 focus:ring-sky-500 focus:border-sky-500"
                        />

                        <div className="space-y-2">
                            <Input
                                label="Category"
                                value={formData.category}
                                onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                                required
                                placeholder="e.g. Starters, Main Course, Drinks"
                                className="bg-sky-50 border-sky-100 text-gray-900 placeholder:text-gray-400 focus:ring-sky-500 focus:border-sky-500"
                            />
                            {Object.keys(groupedItems).length > 0 && (
                                <div className="flex flex-wrap gap-1.5 items-center">
                                    <span className="text-xs text-gray-500 mr-1">Suggested:</span>
                                    {Object.keys(groupedItems).map((cat) => (
                                        <button
                                            key={cat}
                                            type="button"
                                            onClick={() => setFormData({ ...formData, category: cat })}
                                            className="text-xs px-2.5 py-1 rounded-lg border border-sky-100 bg-sky-50/30 text-sky-700 hover:bg-sky-100 transition-colors cursor-pointer"
                                        >
                                            {cat}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>

                        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                            <div>
                                <label htmlFor="dietaryType" className="mb-1.5 block text-sm font-medium text-gray-700">Dietary Type</label>
                                <select id="dietaryType" value={formData.dietaryType} onChange={(event) => setFormData({ ...formData, dietaryType: event.target.value })} className="h-11 w-full rounded-xl border border-sky-100 bg-sky-50 px-4 text-sm text-gray-900 outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20">
                                    <option value="unknown">Not classified</option>
                                    <option value="veg">Vegetarian</option>
                                    <option value="non-veg">Non-Vegetarian</option>
                                    <option value="vegan">Vegan</option>
                                    <option value="egg">Contains Egg</option>
                                </select>
                            </div>
                            <div>
                                <label htmlFor="itemType" className="mb-1.5 block text-sm font-medium text-gray-700">Item Type</label>
                                <select id="itemType" value={formData.itemType} onChange={(event) => setFormData({ ...formData, itemType: event.target.value })} className="h-11 w-full rounded-xl border border-sky-100 bg-sky-50 px-4 text-sm text-gray-900 outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20">
                                    <option value="food">Food</option>
                                    <option value="beverage">Drink / Beverage</option>
                                    <option value="water">Water</option>
                                    <option value="other">Other</option>
                                </select>
                            </div>
                        </div>

                            <div className="rounded-xl border border-sky-100 bg-sky-50/40 p-4">
                            <label className="mb-3 block text-sm font-semibold text-gray-900">Preparing department<select required={recipe.length > 0} value={formData.departmentId} onChange={(event) => setFormData({ ...formData, departmentId: event.target.value })} className="mt-1.5 h-11 w-full rounded-xl border border-sky-100 bg-white px-3 text-sm text-gray-900"><option value="">Select department</option>{departments.map((department) => <option key={department._id} value={department._id}>{department.name}</option>)}</select>{!departments.length && <Link href="/dashboard/inventory" className="mt-1 inline-block text-xs font-normal text-amber-700 underline">Open Kitchen Inventory to create departments.</Link>}</label>
                            <h3 className="text-sm font-semibold text-gray-900">Ingredients for one serving</h3>
                            <p className="mt-1 text-xs text-gray-500">Add each stock item and how much goes into one dish. Example: Paneer Butter Masala → Paneer → 100 g.</p>
                            <div className="mt-3 space-y-2">
                                {recipe.map((entry, index) => {
                                    const stock = inventoryItems.find((item) => item._id === entry.inventoryItemId);
                                    const inputUnit = stock ? recipeInputUnit(stock.unit) : '';
                                    const inputScale = stock ? recipeInputScale(stock.unit) : 1;
                                    return (
                                        <div key={`${entry.inventoryItemId}-${index}`} className="flex flex-wrap items-center gap-2">
                                            <select aria-label="Ingredient" required value={entry.inventoryItemId} onChange={(event) => setRecipe(recipe.map((part, partIndex) => partIndex === index ? { inventoryItemId: event.target.value, quantity: 0 } : part))} className="min-w-44 flex-1 rounded-lg border border-sky-100 bg-white px-3 py-2 text-sm text-gray-900">
                                                <option value="">Select inventory item</option>
                                                {!stock && entry.inventoryItemId && <option value={entry.inventoryItemId}>Archived inventory item</option>}
                                                {inventoryItems.map((item) => <option key={item._id} value={item._id} disabled={recipe.some((part, partIndex) => partIndex !== index && part.inventoryItemId === item._id)}>{item.name} · {item.currentStock} {item.unit} in store</option>)}
                                            </select>
                                            <input aria-label={`Amount per serving in ${inputUnit || 'stock units'}`} type="number" min={inputScale === 1000 ? '1' : '0.0001'} step={inputScale === 1000 ? '1' : '0.0001'} required value={stock && entry.quantity ? displayRecipeQuantity(entry.quantity, stock.unit) : ''} onChange={(event) => setRecipe(recipe.map((part, partIndex) => partIndex === index ? { ...part, quantity: Number(event.target.value) / inputScale } : part))} placeholder="Amount" className="w-28 rounded-lg border border-sky-100 bg-white px-3 py-2 text-sm text-gray-900" />
                                            <span className="w-12 text-xs font-semibold text-gray-600">{inputUnit}</span>
                                            <button type="button" aria-label="Remove inventory item" onClick={() => setRecipe(recipe.filter((_, partIndex) => partIndex !== index))} className="rounded-lg p-2 text-red-500 hover:bg-red-50"><TrashIcon className="h-4 w-4" /></button>
                                            {stock && inputUnit !== stock.unit && <span className="w-full pl-1 text-[11px] text-slate-500">Enter {inputUnit}; inventory stock is tracked in {stock.unit}.</span>}
                                        </div>
                                    );
                                })}
                            </div>
                            <button type="button" disabled={recipe.length >= inventoryItems.length} onClick={() => setRecipe([...recipe, { inventoryItemId: '', quantity: 0 }])} className="mt-3 text-sm font-semibold text-sky-700 disabled:opacity-50">+ Add inventory item</button>
                            {!inventoryItems.length && <p className="mt-2 text-xs text-gray-500">Add stock items in Inventory first.</p>}
                        </div>

                        <div className="space-y-2">
                            <label className="text-sm font-medium text-gray-700">
                                Item Image
                            </label>
                            <div className="flex items-center gap-6">
                                <div className="flex-1">
                                    <input
                                        type="file"
                                        accept="image/*"
                                        onChange={handleFileChange}
                                        className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-sm file:font-semibold file:bg-sky-100 file:text-sky-700 hover:file:bg-sky-200 transition-colors cursor-pointer"
                                    />
                                    <p className="mt-2 text-xs text-gray-400">Maximum file size: 5MB</p>
                                </div>
                                {imagePreview && (
                                    <div className="relative w-24 h-24 rounded-xl overflow-hidden border-2 border-sky-100 shadow-sm">
                                        <img src={imagePreview} alt="Preview" className="w-full h-full object-cover" />
                                    </div>
                                )}
                            </div>
                        </div>

                        <div className="space-y-2">
                            <label className="text-sm font-medium text-gray-700">
                                Instagramable Aesthetic Photo (Separate)
                            </label>
                            <div className="flex items-center gap-6">
                                <div className="flex-1">
                                    <input
                                        type="file"
                                        accept="image/*"
                                        onChange={handleAestheticFileChange}
                                        className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-sm file:font-semibold file:bg-pink-100 file:text-pink-700 hover:file:bg-pink-200 transition-colors cursor-pointer"
                                    />
                                    <p className="mt-2 text-xs text-gray-400">Maximum file size: 5MB</p>
                                </div>
                                {aestheticImagePreview && (
                                    <div className="relative w-24 h-24 rounded-xl overflow-hidden border-2 border-pink-100 shadow-sm">
                                        <img src={aestheticImagePreview} alt="Aesthetic Preview" className="w-full h-full object-cover" />
                                    </div>
                                )}
                            </div>
                            <p className="text-xs text-gray-400 mt-1">This high-quality aesthetic image will be available for customers to download after ordering.</p>
                        </div>

                        <div className="flex justify-end gap-3 pt-4">
                            <Button
                                type="button"
                                variant="ghost"
                                onClick={() => {
                                    setFormData({ name: '', description: '', price: '', category: '', imageUrl: '', aestheticImageUrl: '', dietaryType: 'unknown', itemType: 'food', departmentId: '' });
                                    setRecipe([]);
                                    setSelectedFile(null);
                                    setImagePreview(null);
                                    setSelectedAestheticFile(null);
                                    setAestheticImagePreview(null);
                                    setEditingId(null);
                                    setShowAddForm(false);
                                }}
                                className="text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                            >
                                Cancel
                            </Button>
                            <Button
                                type="submit"
                                isLoading={isSubmitting}
                                className="bg-sky-400 hover:bg-sky-500 text-white shadow-lg shadow-sky-400/20"
                            >
                                {editingId ? 'Save Changes' : 'Add Item'}
                            </Button>
                        </div>
                    </form>
                </div>
            )}

            <div className="grid gap-8">
                {filteredGroupedItems.map(([category, items]) => (
                    <div key={category} className="bg-white border border-gray-100 rounded-2xl shadow-sm overflow-hidden animate-in fade-in duration-300">
                        <div className="px-6 py-4 bg-gray-50/50 border-b border-gray-100">
                            <h2 className="text-lg font-bold text-gray-900 capitalize font-display">
                                {category}
                            </h2>
                        </div>
                        <div className="divide-y divide-gray-100">
                            {items.map((item) => (
                                <div
                                    key={item._id}
                                    className="p-6 flex flex-col md:flex-row gap-6 hover:bg-gray-50/50 transition-colors"
                                >
                                    <div className="flex-1 flex gap-6">
                                        {item.imageUrl && (
                                            <div className="w-24 h-24 rounded-xl overflow-hidden bg-gray-100 border border-gray-200 flex-shrink-0">
                                                <img
                                                    src={item.imageUrl}
                                                    alt={item.name}
                                                    className="w-full h-full object-cover"
                                                />
                                            </div>
                                        )}
                                        <div className="flex-1 space-y-1">
                                            <div className="flex justify-between items-start">
                                                <h3 className="font-semibold text-lg text-gray-900">{item.name}</h3>
                                                <span className="font-bold text-sky-600 text-lg">
                                                    ₹{item.price}
                                                </span>
                                            </div>
                                            <p className="text-sm text-gray-500 line-clamp-2">{item.description}</p>
                                            <div className="flex flex-wrap gap-1.5 pt-1">
                                                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold capitalize text-slate-600">{item.dietaryType === 'non-veg' ? 'Non-Veg' : item.dietaryType || 'Unknown'}</span>
                                                <span className="rounded-full bg-sky-50 px-2 py-0.5 text-[10px] font-semibold capitalize text-sky-700">{item.itemType || 'food'}</span>
                                                {item.departmentId && <span className="rounded-full bg-violet-50 px-2 py-0.5 text-[10px] font-semibold text-violet-700">{departments.find((department) => department._id === item.departmentId)?.name || 'Department unavailable'}</span>}
                                            </div>
                                            {!!item.recipe?.length && <p className="pt-1 text-xs text-slate-500">Per serving: {item.recipe.map((part) => {
                                                const stock = inventoryItems.find((entry) => entry._id === part.inventoryItemId);
                                                return `${stock ? displayRecipeQuantity(part.quantity, stock.unit) : part.quantity} ${stock ? recipeInputUnit(stock.unit) : ''} ${stock?.name || 'archived item'}`;
                                            }).join(' · ')}</p>}
                                            {!item.recipe?.length && <p className="pt-1 text-xs text-amber-700">Inventory not linked</p>}
                                            {!!item.recipe?.length && !item.departmentId && <p className="pt-1 text-xs text-amber-700">Assign a kitchen department to enable stock tracking.</p>}
                                        </div>
                                    </div>

                                    <div className="flex md:flex-col justify-end gap-3 md:border-l md:border-gray-100 md:pl-6 md:ml-2">
                                        <Button
                                            size="sm"
                                            variant="ghost"
                                            onClick={() => handleToggleAvailability(item._id)}
                                            className={`w-full justify-start border transition-all ${item.isAvailable
                                                    ? 'border-transparent text-green-600 hover:bg-green-50'
                                                    : 'border-red-200 bg-red-50/50 text-red-600 hover:bg-red-50'
                                                }`}
                                        >
                                            <span className={`w-2 h-2 rounded-full mr-2 ${item.isAvailable ? 'bg-green-500' : 'bg-red-500'}`} />
                                            {item.isAvailable ? 'Available' : 'Unavailable'}
                                        </Button>
                                        <Button
                                            size="sm"
                                            variant="ghost"
                                            onClick={() => handleEdit(item)}
                                            className="w-full justify-start text-sky-600 hover:bg-sky-50"
                                        >
                                            <PencilIcon className="h-4 w-4 mr-2" />
                                            Edit
                                        </Button>
                                        <Button
                                            size="sm"
                                            variant="ghost"
                                            onClick={() => handleDelete(item._id)}
                                            className="w-full justify-start text-red-400 hover:text-red-600 hover:bg-red-50"
                                        >
                                            <TrashIcon className="h-4 w-4 mr-2" />
                                            Delete
                                        </Button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                ))}
            </div>

            {Object.keys(groupedItems).length === 0 && !showAddForm && (
                <div className="text-center py-16 bg-white border border-gray-100 rounded-2xl shadow-sm">
                    <div className="w-16 h-16 bg-sky-50 text-sky-300 rounded-full flex items-center justify-center mx-auto mb-4">
                        <PlusIcon className="w-8 h-8" />
                    </div>
                    <h3 className="text-lg font-medium text-gray-900">No items yet</h3>
                    <p className="text-gray-500 mt-1 mb-6">
                        Get started by adding your first menu item.
                    </p>
                    <Button
                        onClick={() => setShowAddForm(true)}
                        className="bg-sky-400 hover:bg-sky-500 text-white"
                    >
                        Add Menu Item
                    </Button>
                </div>
            )}
        </div>
    );
}

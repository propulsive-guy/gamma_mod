import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import User from '../models/User';
import Restaurant from '../models/Restaurant';

export class AuthController {
    /**
     * Handle signup - creates user and restaurant
     */
    static async signup(req: Request, res: Response) {
        try {
            const { name, email, password, restaurantName, fssaiNumber, phone, address, secretKey } = req.body;
            const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';

            const validKey = process.env.SIGNUP_SECRET_KEY;
            if (!validKey || secretKey !== validKey) {
                return res.status(400).json({ error: 'Invalid signup secret key' });
            }
            if (typeof address !== 'string' || !address.trim()) {
                return res.status(400).json({ error: 'Restaurant address is required' });
            }

            // Check if user already exists
            const existingUser = await User.findOne({ email: AuthController.emailLookup(normalizedEmail) });
            if (existingUser) {
                return res.status(400).json({ error: 'Email already registered' });
            }

            // Hash password
            const hashedPassword = await bcrypt.hash(password, 10);

            // Create user
            const user = await User.create({
                name,
                email: normalizedEmail,
                password: hashedPassword,
                role: 'restaurant_owner',
            });

            // Generate slug
            let slug = restaurantName
                .toLowerCase()
                .trim()
                .replace(/[^a-z0-9]+/g, '-')
                .replace(/(^-|-$)/g, '');

            if (!slug) {
                slug = 'restaurant-' + Math.random().toString(36).substring(2, 7);
            }

            // Ensure unique slug
            const slugExists = await Restaurant.findOne({ slug });
            if (slugExists) {
                slug = `${slug}-${Math.random().toString(36).substring(2, 7)}`;
            }

            // Create restaurant
            const restaurant = await Restaurant.create({
                name: restaurantName,
                slug,
                ownerId: user._id,
                fssaiNumber: typeof fssaiNumber === 'string' ? fssaiNumber.trim().slice(0, 30) : '',
                phone: typeof phone === 'string' ? phone.trim().slice(0, 30) : '',
                address: address.trim().slice(0, 300),
            });

            // Update user
            user.restaurantId = restaurant._id;
            await user.save();

            res.status(201).json({ success: true });
        } catch (error: any) {
            console.error('Signup API error:', error);
            res.status(500).json({ error: 'Failed to create account' });
        }
    }

    /**
     * Verify credentials for NextAuth provider login
     */
    static async verify(req: Request, res: Response) {
        try {
            const { email, password } = req.body;
            const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';

            if (!normalizedEmail || typeof password !== 'string' || !password) {
                return res.status(400).json({ error: 'Email and password are required' });
            }

            const user = await User.findOne({ email: AuthController.emailLookup(normalizedEmail) });
            if (!user) {
                return res.status(401).json({ error: 'Invalid credentials' });
            }

            const isPasswordValid = await bcrypt.compare(password, user.password);
            if (!isPasswordValid) {
                return res.status(401).json({ error: 'Invalid credentials' });
            }

            res.json({
                id: user._id.toString(),
                email: user.email,
                name: user.name,
                role: user.role,
                restaurantId: user.restaurantId?.toString(),
            });
        } catch (error: any) {
            console.error('Verify API error:', error);
            res.status(500).json({ error: 'Authentication failed' });
        }
    }

    /** Match normalized emails and legacy records that may contain mixed case. */
    private static emailLookup(email: string) {
        const escapedEmail = email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return new RegExp(`^${escapedEmail}$`, 'i');
    }
}

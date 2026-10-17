import { rateLimit } from 'express-rate-limit';

/**
 * Strict rate limiter for the order creation endpoint.
 * Prevents spam ordering — 10 orders per minute per IP.
 */
export const orderRateLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    limit: 10,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: {
        error: 'Too many orders placed from this IP. Please wait a minute before trying again.',
    },
    skipSuccessfulRequests: false,
});

/**
 * General rate limiter for public-facing read endpoints (menu, restaurant info, table info).
 * 120 requests per minute per IP — generous enough for normal use.
 */
export const publicReadLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    limit: 120,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: {
        error: 'Too many requests from this IP. Please slow down.',
    },
    skipSuccessfulRequests: true,
});

/**
 * Strict rate limiter for authentication endpoints.
 * 10 attempts per 15 minutes per IP — guards against brute-force.
 */
export const authRateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    limit: 10,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: {
        error: 'Too many authentication attempts. Please try again later.',
    },
    skipSuccessfulRequests: true,
});

/** Limit paid image-model calls while allowing normal bill/menu retries. */
export const geminiOcrRateLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 10,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: 'Too many image scans. Please wait a minute and try again.' },
    skipSuccessfulRequests: false,
});

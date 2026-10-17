import './env';
import express from 'express';
import next from 'next';
import { createServer } from 'http';
import { initSocket } from './socket/index';
import dbConnect from './lib/db';
import redis from './lib/redis';
import session from 'express-session';
import { RedisStore } from 'connect-redis';
import orderRoutes from './routes/orderRoutes';
import authRoutes from './routes/authRoutes';
import restaurantRoutes from './routes/restaurantRoutes';
import menuRoutes from './routes/menuRoutes';
import tableRoutes from './routes/tableRoutes';
import analyticsRoutes from './routes/analyticsRoutes';
import uploadRoutes from './routes/uploadRoutes';
import inventoryRoutes from './routes/inventoryRoutes';
import geminiOcrRoutes from './routes/geminiOcrRoutes';
import { corsMiddleware } from './middleware/cors';
import { requestLogger } from './middleware/requestLogger';
import logger from './lib/logger';

const dev = process.env.NODE_ENV !== 'production';
const apiOnly = process.env.API_ONLY === 'true';

async function startServer() {
    await dbConnect();
    logger.info('Connected to MongoDB');

    const expressApp = express();

    // Structured HTTP request logging (before all other middleware)
    expressApp.use(requestLogger);

    // Enable CORS for cross-origin frontend requests
    expressApp.use(corsMiddleware);
    // Base64 image uploads for menu and restaurant settings exceed Express's default JSON limit.
    expressApp.use(express.json({ limit: '10mb' }));
    
    const server = createServer(expressApp);

    // Express Session Store — Redis is required in production to avoid memory leaks
    // and session loss on restart. Falls back to MemoryStore only in development.
    let sessionStore;
    const hasRedisUrl = !!process.env.REDIS_URL;

    if (process.env.NODE_ENV === 'production' && !hasRedisUrl) {
        logger.warn(
            'REDIS_URL is not set in production. Using MemoryStore for sessions. ' +
            'This is acceptable for single-instance deployments but will leak memory ' +
            'and lose sessions on restart at scale. Set REDIS_URL for production-grade sessions.'
        );
    }

    if (hasRedisUrl) {
        sessionStore = new RedisStore({
            client: redis,
            prefix: 'bitbyte:sess:',
        });
        logger.info('Using Redis session store');
    } else {
        logger.warn('Redis URL not configured — falling back to in-memory session store (development only)');
    }

    expressApp.use(
        session({
            store: sessionStore, // If undefined, express-session defaults to MemoryStore
            secret: process.env.NEXTAUTH_SECRET || 'strong-secret',
            resave: false,
            saveUninitialized: false,
            cookie: {
                secure: process.env.NODE_ENV === 'production',
                httpOnly: true,
                maxAge: 1000 * 60 * 60 * 24 * 7,
            },
        })
    );

    // Initialize Sockets (async — may attach Redis adapter)
    const io = await initSocket(server);
    (global as any).io = io;

    // Express API Routes
    expressApp.use('/api/v1/orders', orderRoutes);
    expressApp.use('/api/v1/auth', authRoutes);
    expressApp.use('/api/v1/restaurant', restaurantRoutes);
    expressApp.use('/api/v1/menu', menuRoutes);
    expressApp.use('/api/v1/tables', tableRoutes);
    expressApp.use('/api/v1/analytics', analyticsRoutes);
    expressApp.use('/api/v1/upload', uploadRoutes);
    expressApp.use('/api/v1/inventory', inventoryRoutes);
    expressApp.use('/api/v1/ocr', geminiOcrRoutes);

    expressApp.get('/api/health', (req, res) => {
        res.json({
            status: 'UP',
            architecture: apiOnly ? 'Traditional/Explicit Server (API Only)' : 'Traditional/Explicit Server',
            timestamp: new Date()
        });
    });

    expressApp.use((error: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
        if (error?.type === 'entity.too.large') {
            return res.status(413).json({ error: 'Image is too large. Please upload an image under 5MB.' });
        }
        logger.error({ err: error, url: req.url, method: req.method }, 'Unhandled Express error');
        next(error);
    });

    // Next.js Catch-all - only loaded if NOT in API-only mode
    if (!apiOnly) {
        const app = next({ dev, dir: './client' });
        const handle = app.getRequestHandler();
        await app.prepare();
        
        expressApp.all(/^(.*)$/, (req, res) => handle(req, res));
    } else {
        logger.info('Running in API-only mode (Next.js bypassed)');
    }

    const PORT = process.env.PORT || 3000;
    server.listen(PORT, () => {
        logger.info({ port: PORT, mode: apiOnly ? 'api-only' : 'unified' }, `BitByte server ready`);
    });
}

startServer().catch((error) => {
    logger.error({ err: error }, 'Failed to start server');
    process.exit(1);
});

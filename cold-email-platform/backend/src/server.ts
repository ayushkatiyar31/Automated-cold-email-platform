import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { env } from './config/env';
import { connectDatabase, disconnectDatabase } from './config/db';
import { logger } from './config/logger';
import authRoutes from './routes/auth';
import uploadRoutes from './routes/uploads';
import recipientRoutes from './routes/recipients';
import gmailRoutes from './routes/gmail';
import campaignRoutes from './routes/campaigns';
import templateRoutes from './routes/templates';
import { csrfProtection } from './middleware/csrf';
import { errorHandler, notFoundHandler } from './middleware/error';

const app = express();
app.use(helmet());
const writeLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 300, standardHeaders: true, legacyHeaders: false });
app.use(cors({
  origin(origin, callback) {
    const allowed = env.frontendUrl.split(',').map(value => value.trim()).filter(Boolean);
    if (!origin || allowed.includes(origin)) callback(null, true);
    else callback(new Error('Origin is not allowed by CORS'));
  },
  credentials: true, allowedHeaders: ['Content-Type', 'X-Requested-With']
}));
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());
app.use(csrfProtection);
app.use(['/api/campaigns', '/api/templates', '/api/uploads', '/api/recipients'], writeLimiter);
app.get('/health', (_req, res) => res.json({ ok: true }));
app.use('/api/auth', authRoutes);
app.use('/api/uploads', uploadRoutes);
app.use('/api/recipients', recipientRoutes);
app.use('/api/gmail', gmailRoutes);
app.use('/api/campaigns', campaignRoutes);
app.use('/api/templates', templateRoutes);
app.use(notFoundHandler);
app.use(errorHandler);

async function start() { await connectDatabase(); const server = app.listen(env.port, () => logger.info({ port: env.port }, 'API started')); for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { server.close(async () => { await disconnectDatabase(); logger.info({ signal }, 'API stopped gracefully'); process.exit(0); }); }); }
start().catch(error => { logger.error(error); process.exit(1); });
export default app;

import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { env } from './config/env';
import { connectDatabase, disconnectDatabase } from './config/db';
import { logger } from './config/logger';
import { PARSE_QUEUE_NAME, WORKER_HEARTBEAT_KEY, parseQueue } from './services/queue';
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
    const allowed = env.frontendUrls;
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
app.get('/api/health', async (_req, res) => {
  try {
    const heartbeat = await (await parseQueue.client).get(WORKER_HEARTBEAT_KEY);
    const heartbeatAt = heartbeat ? Number(heartbeat) : null;
    const alive = heartbeatAt !== null && Number.isFinite(heartbeatAt) && Date.now() - heartbeatAt <= 30_000;
    res.status(alive ? 200 : 503).json({
      ok: alive,
      worker: { alive, lastHeartbeat: heartbeatAt ? new Date(heartbeatAt).toISOString() : null },
      parseQueue: PARSE_QUEUE_NAME
    });
  } catch (error) {
    logger.error({ error }, 'Worker health check failed');
    res.status(503).json({ ok: false, worker: { alive: false }, error: 'Worker health check unavailable' });
  }
});
app.use('/api/auth', authRoutes);
app.use('/api/uploads', uploadRoutes);
app.use('/api/recipients', recipientRoutes);
app.use('/api/gmail', gmailRoutes);
app.use('/api/campaigns', campaignRoutes);
app.use('/api/templates', templateRoutes);
app.use(notFoundHandler);
app.use(errorHandler);

async function start() {
  await connectDatabase();
  logger.info('MongoDB connected');
  const server = app.listen(env.port, () => logger.info({ port: env.port }, `API listening on port ${env.port}`));
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      server.close(async () => {
        await disconnectDatabase();
        logger.info({ signal }, 'API stopped gracefully');
        process.exit(0);
      });
    });
  }
}
start().catch(error => { logger.error(error); process.exit(1); });
export default app;

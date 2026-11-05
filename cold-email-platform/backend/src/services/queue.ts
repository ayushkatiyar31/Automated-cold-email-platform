import { Queue } from 'bullmq';
import { redisConnection } from '../config/redis';

export const parseQueue = new Queue('file-parsing', { connection: redisConnection });

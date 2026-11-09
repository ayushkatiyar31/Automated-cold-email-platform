import { Queue } from 'bullmq';
import { redisConnection } from '../config/redis';

export const PARSE_QUEUE_NAME = 'file-parsing';
export const WORKER_HEARTBEAT_KEY = 'file-parsing:worker:heartbeat';
export const parseQueue = new Queue(PARSE_QUEUE_NAME, { connection: redisConnection });

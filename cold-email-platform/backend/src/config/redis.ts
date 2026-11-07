import { ConnectionOptions } from 'bullmq';
import { env } from './env';
export const redisConnection: ConnectionOptions = {
  url: env.redisUrl,
  maxRetriesPerRequest: null
};

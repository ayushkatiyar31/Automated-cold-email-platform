import { Queue } from 'bullmq';
import { redisConnection } from '../config/redis';
export const campaignQueue = new Queue('campaign-send', { connection: redisConnection });
export const sendCampaign = (campaignId: string) => campaignQueue.add('send-campaign', { campaignId }, {
  jobId: `campaign:${campaignId}`,
  removeOnComplete: true,
  attempts: 1
});

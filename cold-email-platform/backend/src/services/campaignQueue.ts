import { Queue } from 'bullmq';
import { redisConnection } from '../config/redis';
export const CAMPAIGN_SEND_QUEUE_NAME = 'campaign-send';
export const campaignQueue = new Queue(CAMPAIGN_SEND_QUEUE_NAME, { connection: redisConnection });
export const sendCampaign = (campaignId: string) => campaignQueue.add('send-campaign', { campaignId }, {
  jobId: `campaign-${campaignId}`,
  removeOnComplete: true,
  attempts: 1
});

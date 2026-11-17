import type { Types } from 'mongoose';
import crypto from 'crypto';
import { google } from 'googleapis';
import { Queue, Worker } from 'bullmq';
import type { ConnectionOptions } from 'bullmq';
import pino from 'pino';
import type { WorkerModels } from './models';

const log = pino();
const CAMPAIGN_SEND_QUEUE_NAME = 'campaign-send';
const DAY_MS = 24 * 60 * 60 * 1000;
const SEND_DELAY_MS = 1000;
const encryptionKey = () => Buffer.from(process.env.TOKEN_ENCRYPTION_KEY ?? '', 'hex');

function decrypt(value: string) {
  const [, iv, tag, data] = value.split(':');
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString();
}
function encrypt(value: string) {
  const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value), cipher.final()]);
  return `v1:${iv.toString('base64url')}:${cipher.getAuthTag().toString('base64url')}:${encrypted.toString('base64url')}`;
}
function escapeHtml(value: string) { return value.replace(/[&<>"']/g, ch => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[ch]!)); }
function render(campaign: any, recipient: any, senderName: string) {
  const values: Record<string,string> = { name: recipient.name || '', first_name: recipient.name?.trim().split(/\s+/)[0] || '', company: recipient.company || '', email: recipient.email, resume_link: campaign.resumeLink || '', sender_name: senderName };
  const renderText = (text: string) => text.replace(/\{\{\s*([a-z_]+)(?:\|([^}]*))?\s*\}\}/g, (_: string, key: string, fallback?: string) => values[key]?.trim() || fallback?.trim() || '');
  let body = campaign.body;
  if (campaign.includeResumeLink !== false && campaign.resumeLink && !/\{\{\s*resume_link(?:\|[^}]*)?\s*\}\}/.test(body)) body += '\n\nResume: {{resume_link}}';
  if (campaign.optOutEnabled && campaign.optOutLine) body += `\n\n${campaign.optOutLine}`;
  const text = renderText(body), subject = renderText(campaign.subject);
  return { text, subject, html: escapeHtml(text).replace(/\r?\n/g, '<br>') };
}
function safe(value: string) { return value.replace(/[\r\n]/g, '').trim(); }
function classify(error: any) {
  const text = JSON.stringify(error?.response?.data ?? error) + String(error?.message ?? '');
  if (/invalid_grant/i.test(text)) return 'auth';
  if (/invalidAddress|invalidRecipient/i.test(text)) return 'permanent';
  if (Number(error?.response?.status ?? error?.code) === 429 || /rateLimitExceeded|userRateLimitExceeded|dailyLimitExceeded|rate.?limit/i.test(text)) return 'quota';
  if (error?.code >= 500 || ['ECONNRESET','ETIMEDOUT','ENOTFOUND'].includes(error?.code)) return 'transient';
  return 'unknown';
}
async function counts(campaignId: Types.ObjectId, models: WorkerModels) {
  const { Campaign, Recipient } = models;
  const pipeline = await Recipient.aggregate([{ $match: { campaignId } }, { $group: { _id: '$status', count: { $sum: 1 } } }]);
  const result: any = { total: await Recipient.countDocuments({ campaignId }), pending: 0, sending: 0, sent: 0, failed: 0, skipped: 0 };
  for (const row of pipeline) if (row._id in result) result[row._id] = row.count;
  await Campaign.updateOne({ _id: campaignId }, { $set: { counts: result } });
  return result;
}

async function getQuotaWindow(userId: Types.ObjectId, models: WorkerModels) {
  const { SendQuota, EmailLog } = models;
  const now = new Date();
  let quota = await SendQuota.findOne({ userId });
  if (!quota) {
    const recentFilter = { userId, status: 'sent', createdAt: { $gte: new Date(now.getTime() - DAY_MS) } };
    const [firstRecentSend, sentCount] = await Promise.all([
      EmailLog.findOne(recentFilter).sort({ createdAt: 1 }).select('createdAt'),
      EmailLog.countDocuments(recentFilter)
    ]);
    await SendQuota.updateOne({ userId }, {
      $setOnInsert: { windowStartedAt: firstRecentSend?.createdAt ?? now, sentCount }
    }, { upsert: true });
    quota = await SendQuota.findOne({ userId });
  }
  if (!quota) throw new Error(`Unable to initialize send quota for user ${userId}`);
  if (quota.windowStartedAt.getTime() + DAY_MS <= now.getTime()) {
    await SendQuota.updateOne(
      { userId, windowStartedAt: quota.windowStartedAt },
      { $set: { windowStartedAt: now, sentCount: 0 } }
    );
    quota = await SendQuota.findOne({ userId });
  }
  if (!quota) throw new Error(`Unable to load send quota for user ${userId}`);
  return quota;
}

async function scheduleQuotaResume(campaignId: string, resumeAt: Date, campaignQueue: Queue) {
  await campaignQueue.add('send-campaign', { campaignId, autoResume: true }, {
    jobId: `campaign-${campaignId}-quota-${resumeAt.getTime()}-${Date.now()}`,
    delay: Math.max(0, resumeAt.getTime() - Date.now()),
    removeOnComplete: true,
    attempts: 1
  });
}

async function pauseForQuota(campaignId: string, recipientId: Types.ObjectId | undefined, resumeAt: Date, models: WorkerModels, campaignQueue: Queue) {
  const { Campaign, Recipient } = models;
  await Campaign.updateOne({ _id: campaignId }, {
    $set: { status: 'paused', pauseReason: 'waiting for quota', quotaResumeAt: resumeAt }
  });
  if (recipientId) {
    await Recipient.updateOne({ _id: recipientId }, {
      $set: { status: 'pending', nextAttemptAt: resumeAt },
      $unset: { error: 1, errorCode: 1 }
    });
  }
  await scheduleQuotaResume(campaignId, resumeAt, campaignQueue);
}

async function sendCampaignJob(campaignId: string, models: WorkerModels, campaignQueue: Queue, dailySendLimit: number, autoResume = false) {
  const { Campaign, Recipient, User, EmailLog, SendQuota } = models;
  let campaign = await Campaign.findById(campaignId);
  if (!campaign) return;
  if (autoResume) {
    if (campaign.status !== 'paused' || campaign.pauseReason !== 'waiting for quota') return;
    const resumeAt = campaign.quotaResumeAt?.getTime() ?? 0;
    if (resumeAt > Date.now()) {
      await scheduleQuotaResume(campaignId, new Date(resumeAt), campaignQueue);
      return;
    }
    const resumed = await Campaign.updateOne({
      _id: campaignId,
      status: 'paused',
      pauseReason: 'waiting for quota',
      quotaResumeAt: { $lte: new Date() }
    }, { $set: { status: 'pending' }, $unset: { pauseReason: 1, quotaResumeAt: 1 } });
    if (!resumed.modifiedCount) return;
    campaign = await Campaign.findById(campaignId);
  } else if (campaign.status !== 'pending') {
    return;
  }
  if (!campaign || campaign.status !== 'pending') return;
  const user = await User.findById(campaign.userId).select('+gmail.accessToken +gmail.refreshToken');
  if (!user?.gmail?.refreshToken) { campaign.status = 'paused'; campaign.pauseReason = 'Gmail reconnect required'; await campaign.save(); return; }
  const oauth = new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET);
  oauth.setCredentials({ access_token: decrypt(String(user.gmail.accessToken)), refresh_token: decrypt(String(user.gmail.refreshToken)), expiry_date: user.gmail.expiryDate });
  try {
    const refreshed = await oauth.getAccessToken();
    if (!refreshed.token) throw new Error('Missing Gmail access token');
    const credentials = oauth.credentials;
    await User.updateOne({ _id: user.id }, { $set: { 'gmail.accessToken': encrypt(credentials.access_token ?? refreshed.token), ...(credentials.refresh_token ? { 'gmail.refreshToken': encrypt(credentials.refresh_token) } : {}), 'gmail.expiryDate': credentials.expiry_date } });
  } catch (error) { if (/invalid_grant/i.test(String(error))) { await Campaign.updateOne({ _id: campaignId }, { $set: { status: 'paused', pauseReason: 'Gmail reconnect required' } }); await User.updateOne({ _id: user.id }, { $unset: { gmail: 1 } }); } throw error; }

  while (true) {
    const current = await Campaign.findById(campaignId);
    if (!current || current.status !== 'pending') break;
    const quota = await getQuotaWindow(user.id, models);
    if (quota.sentCount >= dailySendLimit) {
      await pauseForQuota(campaignId, undefined, new Date(quota.windowStartedAt.getTime() + DAY_MS), models, campaignQueue);
      break;
    }
    const recipient = await Recipient.findOneAndUpdate({ campaignId, status: 'pending', nextAttemptAt: { $not: { $gt: new Date() } }, gmailMessageId: { $exists: false } }, { $set: { status: 'sending' }, $inc: { attempts: 1 } }, { new: true });
    if (!recipient) break;
    let sent = false;
    try {
      const rendered = render(current, recipient, String(user.name ?? ''));
      const boundary = `b_${crypto.randomBytes(12).toString('hex')}`;
      const message = [
        `From: ${safe(String(user.name ?? ''))} <${safe(String(user.gmail.email ?? user.email))}>` , `To: <${safe(String(recipient.email))}>`, `Subject: ${safe(String(rendered.subject))}`,
        'MIME-Version: 1.0', `Content-Type: multipart/alternative; boundary="${boundary}"`, '',
        `--${boundary}`, 'Content-Type: text/plain; charset=UTF-8', '', rendered.text,
        `--${boundary}`, 'Content-Type: text/html; charset=UTF-8', '', rendered.html, '', `--${boundary}--`
      ].join('\r\n');
      const gmail = google.gmail({ version: 'v1', auth: oauth });
      const result = await gmail.users.messages.send({ userId: 'me', requestBody: { raw: Buffer.from(message).toString('base64url') } });
      await SendQuota.updateOne({ userId: user.id }, { $inc: { sentCount: 1 } });
      await Recipient.updateOne({ _id: recipient._id, status: 'sending' }, { $set: { status: 'sent', sentAt: new Date(), gmailMessageId: result.data.id }, $unset: { error: 1, errorCode: 1 } });
      await EmailLog.updateOne({ campaignId, idempotencyKey: recipient.idempotencyKey }, { $setOnInsert: { userId: recipient.userId, recipientId: recipient._id, recipientEmail: recipient.email, providerMessageId: result.data.id, status: 'sent', idempotencyKey: recipient.idempotencyKey } }, { upsert: true });
      sent = true;
    } catch (error: any) {
      const kind = classify(error);
      if (kind === 'auth') {
        await Campaign.updateOne({ _id: campaignId }, { $set: { status: 'paused', pauseReason: 'Gmail reconnect required' } });
        await Recipient.updateOne({ _id: recipient._id }, { $set: { status: 'pending' }, $unset: { error: 1 } });
        break;
      }
      if (kind === 'quota') {
        await pauseForQuota(campaignId, recipient._id, new Date(quota.windowStartedAt.getTime() + DAY_MS), models, campaignQueue);
        break;
      }
      if (kind === 'transient') {
        const delay = Math.min(60 * 60 * 1000, 5000 * (2 ** Math.min(recipient.attempts, 8)));
        await Recipient.updateOne({ _id: recipient._id }, { $set: { status: 'pending', error: error.message, errorCode: 'TRANSIENT', nextAttemptAt: new Date(Date.now() + delay) } });
        await campaignQueue.add('send-campaign', { campaignId }, { delay, jobId: `campaign-${campaignId}`, removeOnComplete: true });
        break;
      }
      await Recipient.updateOne({ _id: recipient._id }, { $set: { status: 'failed', error: error.message, errorCode: kind === 'permanent' ? 'PERMANENT' : 'UNKNOWN' } });
      await EmailLog.updateOne({ campaignId, idempotencyKey: recipient.idempotencyKey }, { $setOnInsert: { userId: recipient.userId, recipientId: recipient._id, recipientEmail: recipient.email, status: 'failed', error: error.message, errorCode: kind, idempotencyKey: recipient.idempotencyKey } }, { upsert: true });
    }
    await counts(campaign._id, models);
    if (sent) await new Promise(resolve => setTimeout(resolve, SEND_DELAY_MS));
  }
  const remaining = await counts(campaign._id, models);
  if (remaining.pending === 0 && remaining.sending === 0) await Campaign.updateOne({ _id: campaignId, status: 'pending' }, { $set: { status: 'sent' } });
}

export async function runSendWorker(models: WorkerModels, connection: ConnectionOptions) {
  const { Recipient } = models;
  const dailySendLimit = Number(process.env.DAILY_SEND_LIMIT ?? 450);
  if (!Number.isInteger(dailySendLimit) || dailySendLimit < 1) throw new Error('DAILY_SEND_LIMIT must be a positive integer');
  await Recipient.updateMany({ status: 'sending', gmailMessageId: { $exists: false }, updatedAt: { $lt: new Date(Date.now() - 5 * 60 * 1000) } }, { $set: { status: 'pending' } });
  const campaignQueue = new Queue(CAMPAIGN_SEND_QUEUE_NAME, { connection });
  let worker: Worker;
  try {
    worker = new Worker(CAMPAIGN_SEND_QUEUE_NAME, job => sendCampaignJob(job.data.campaignId, models, campaignQueue, dailySendLimit, job.data.autoResume === true), { connection, concurrency: 1 });
  } catch (error) {
    await campaignQueue.close();
    throw error;
  }
  worker.on('failed', (job, error) => log.error({ jobId: job?.id, error: error.message }, 'Campaign send failed'));
  const timer = setInterval(async () => { try { await Recipient.updateMany({ status: 'sending', gmailMessageId: { $exists: false }, updatedAt: { $lt: new Date(Date.now() - 5 * 60 * 1000) } }, { $set: { status: 'pending' } }); } catch (error) { log.error(error); } }, 60_000);
  return async () => {
    clearInterval(timer);
    await worker.close();
    await campaignQueue.close();
  };
}

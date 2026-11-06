import mongoose from 'mongoose';
import crypto from 'crypto';
import { google } from 'googleapis';
import { Worker, Queue } from 'bullmq';
import pino from 'pino';
import { Campaign, Recipient, User, EmailLog } from './models';

const log = pino();
const redisUrl = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';
const key = Buffer.from(process.env.TOKEN_ENCRYPTION_KEY ?? '', 'hex');

function decrypt(value: string) {
  const [, iv, tag, data] = value.split(':');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString();
}
function encrypt(value: string) {
  const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
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
  if (error?.code === 429 || /rateLimitExceeded|userRateLimitExceeded|dailyLimitExceeded/i.test(text)) return 'quota';
  if (error?.code >= 500 || ['ECONNRESET','ETIMEDOUT','ENOTFOUND'].includes(error?.code)) return 'transient';
  return 'unknown';
}
async function counts(campaignId: mongoose.Types.ObjectId) {
  const pipeline = await Recipient.aggregate([{ $match: { campaignId } }, { $group: { _id: '$status', count: { $sum: 1 } } }]);
  const result: any = { total: await Recipient.countDocuments({ campaignId }), pending: 0, sending: 0, sent: 0, failed: 0, skipped: 0 };
  for (const row of pipeline) if (row._id in result) result[row._id] = row.count;
  await Campaign.updateOne({ _id: campaignId }, { $set: { counts: result } });
  return result;
}

async function sendCampaignJob(campaignId: string) {
  const campaign = await Campaign.findById(campaignId);
  if (!campaign || !['pending','paused'].includes(String(campaign.status ?? ''))) return;
  if (campaign.status === 'paused') return;
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
    const recipient = await Recipient.findOneAndUpdate({ campaignId, status: 'pending', nextAttemptAt: { $not: { $gt: new Date() } }, gmailMessageId: { $exists: false } }, { $set: { status: 'sending' }, $inc: { attempts: 1 } }, { new: true });
    if (!recipient) break;
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
      await Recipient.updateOne({ _id: recipient._id, status: 'sending' }, { $set: { status: 'sent', sentAt: new Date(), gmailMessageId: result.data.id }, $unset: { error: 1, errorCode: 1 } });
      await EmailLog.updateOne({ campaignId, idempotencyKey: recipient.idempotencyKey }, { $setOnInsert: { userId: recipient.userId, recipientId: recipient._id, recipientEmail: recipient.email, providerMessageId: result.data.id, status: 'sent', idempotencyKey: recipient.idempotencyKey } }, { upsert: true });
    } catch (error: any) {
      const kind = classify(error);
      if (kind === 'auth') {
        await Campaign.updateOne({ _id: campaignId }, { $set: { status: 'paused', pauseReason: 'Gmail reconnect required' } });
        await Recipient.updateOne({ _id: recipient._id }, { $set: { status: 'pending' }, $unset: { error: 1 } });
        break;
      }
      if (kind === 'quota') {
        await Campaign.updateOne({ _id: campaignId }, { $set: { status: 'paused', pauseReason: 'quota reached' } });
        await Recipient.updateOne({ _id: recipient._id }, { $set: { status: 'pending', nextAttemptAt: new Date(Date.now() + 15 * 60 * 1000) } });
        break;
      }
      if (kind === 'transient') {
        const delay = Math.min(60 * 60 * 1000, 5000 * (2 ** Math.min(recipient.attempts, 8)));
        await Recipient.updateOne({ _id: recipient._id }, { $set: { status: 'pending', error: error.message, errorCode: 'TRANSIENT', nextAttemptAt: new Date(Date.now() + delay) } });
        await new Queue('campaign-send', { connection: { url: redisUrl } }).add('send-campaign', { campaignId }, { delay, jobId: `campaign:${campaignId}`, removeOnComplete: true });
        break;
      }
      await Recipient.updateOne({ _id: recipient._id }, { $set: { status: 'failed', error: error.message, errorCode: kind === 'permanent' ? 'PERMANENT' : 'UNKNOWN' } });
      await EmailLog.updateOne({ campaignId, idempotencyKey: recipient.idempotencyKey }, { $setOnInsert: { userId: recipient.userId, recipientId: recipient._id, recipientEmail: recipient.email, status: 'failed', error: error.message, errorCode: kind, idempotencyKey: recipient.idempotencyKey } }, { upsert: true });
    }
    await counts(campaign._id);
  }
  const remaining = await counts(campaign._id);
  if (remaining.pending === 0 && remaining.sending === 0) await Campaign.updateOne({ _id: campaignId, status: 'pending' }, { $set: { status: 'sent' } });
}

export async function runSendWorker() {
  await Recipient.updateMany({ status: 'sending', gmailMessageId: { $exists: false }, updatedAt: { $lt: new Date(Date.now() - 5 * 60 * 1000) } }, { $set: { status: 'pending' } });
  const timer = setInterval(async () => { try { await Recipient.updateMany({ status: 'sending', gmailMessageId: { $exists: false }, updatedAt: { $lt: new Date(Date.now() - 5 * 60 * 1000) } }, { $set: { status: 'pending' } }); } catch (error) { log.error(error); } }, 60_000);
  const worker = new Worker('campaign-send', job => sendCampaignJob(job.data.campaignId), { connection: { url: redisUrl } as any, concurrency: 1 });
  worker.on('failed', (job, error) => log.error({ jobId: job?.id, error: error.message }, 'Campaign send failed'));
  const shutdown = async () => { clearInterval(timer); await worker.close(); await mongoose.disconnect(); process.exit(0); };
  process.once('SIGINT', shutdown); process.once('SIGTERM', shutdown);
}

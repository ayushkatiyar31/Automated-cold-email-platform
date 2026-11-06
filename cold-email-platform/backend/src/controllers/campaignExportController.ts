import { RequestHandler } from 'express';
import type { Request } from 'express';
import { Campaign } from '../models/Campaign';
import { Recipient } from '../models/Recipient';
import { AuthRequest } from '../middleware/auth';
import { AppError, notFound } from '../utils/errors';
import { assertOwner, objectId } from '../utils/ownership';

export function csvCell(value: unknown) {
  let text = String(value ?? '');
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  if (/[",\r\n]/.test(text)) text = `"${text.replace(/"/g, '""')}"`;
  return text;
}
function csvDownload(res: any, filename: string, headers: string[], rows: AsyncIterable<any>, fields: string[]) {
  res.status(200);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Cache-Control', 'no-store');
  res.flushHeaders();
  res.write('\ufeff');
  res.write(headers.map(csvCell).join(',') + '\r\n');
  (async () => {
    try {
      for await (const row of rows) res.write(fields.map(field => csvCell(row[field])).join(',') + '\r\n');
      res.end();
    } catch (error) { res.destroy(error instanceof Error ? error : new Error(String(error))); }
  })();
}

async function ownedCampaign(req: Request) {
  const campaign = await Campaign.findById(objectId(req.params.id));
  if (!campaign) throw notFound('Campaign not found');
  assertOwner(campaign.userId, (req as AuthRequest).user!.id);
  return campaign;
}

export const exportRecipients: RequestHandler = async (req, res, next) => {
  try {
    const campaign = await ownedCampaign(req);
    csvDownload(res, `${campaign.id}-recipients.csv`, ['email', 'name', 'company', 'status'],
      Recipient.find({ campaignId: campaign.id }).lean().cursor(), ['email', 'name', 'company', 'status']);
  } catch (error) { next(error); }
};

export const exportReport: RequestHandler = async (req, res, next) => {
  try {
    const campaign = await ownedCampaign(req);
    csvDownload(res, `${campaign.id}-report.csv`,
      ['email', 'name', 'company', 'status', 'attempts', 'error', 'sentAt', 'gmailMessageId'],
      Recipient.find({ campaignId: campaign.id }).lean().cursor(),
      ['email', 'name', 'company', 'status', 'attempts', 'error', 'sentAt', 'gmailMessageId']);
  } catch (error) { next(error); }
};

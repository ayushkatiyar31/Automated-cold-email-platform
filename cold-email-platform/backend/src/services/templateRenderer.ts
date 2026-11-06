import { AppError } from '../utils/errors';

export interface TemplateRecipient {
  name?: string; email: string; company?: string;
}
const allowed = new Set(['name', 'first_name', 'company', 'email', 'resume_link', 'sender_name']);

export function validatePlaceholders(text: string) {
  const matches = [...text.matchAll(/\{\{\s*([a-z_]+)(?:\|[^}]*)?\s*\}\}/g)];
  for (const match of matches) {
    if (!allowed.has(match[1])) throw new AppError(400, `Unknown placeholder: ${match[1]}`, 'UNKNOWN_PLACEHOLDER');
  }
  return text;
}

export function renderTemplate(text: string, recipient: TemplateRecipient, senderName: string, resumeLink?: string) {
  const firstName = recipient.name?.trim().split(/\s+/)[0];
  const values: Record<string, string> = {
    name: recipient.name?.trim() || '', first_name: firstName || '', company: recipient.company?.trim() || '',
    email: recipient.email, resume_link: resumeLink || '', sender_name: senderName
  };
  return text.replace(/\{\{\s*([a-z_]+)(?:\|([^}]*))?\s*\}\}/g, (_whole, key: string, fallback?: string) => {
    if (!allowed.has(key)) throw new AppError(400, `Unknown placeholder: ${key}`, 'UNKNOWN_PLACEHOLDER');
    return values[key]?.trim() || fallback?.trim() || '';
  });
}

export function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]!));
}

export function renderCampaign(campaign: { subject: string; body: string; resumeLink?: string; includeResumeLink?: boolean; optOutEnabled?: boolean; optOutLine?: string },
  recipient: TemplateRecipient, senderName: string) {
  validatePlaceholders(`${campaign.subject}\n${campaign.body}`);
  let body = campaign.body;
  if (campaign.includeResumeLink !== false && campaign.resumeLink && !/\{\{\s*resume_link(?:\|[^}]*)?\s*\}\}/.test(body)) {
    body += `\n\nResume: {{resume_link}}`;
  }
  if (campaign.optOutEnabled && campaign.optOutLine?.trim()) body += `\n\n${campaign.optOutLine.trim()}`;

  const renderedText = renderTemplate(`${body}`, recipient, senderName, campaign.resumeLink);
  const subject = renderTemplate(campaign.subject, recipient, senderName, campaign.resumeLink);
  const htmlBody = escapeHtml(renderedText).replace(/\r?\n/g, '<br>');
  return { subject, text: renderedText, html: htmlBody };
}

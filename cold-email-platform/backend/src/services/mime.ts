export function safeHeader(value: string): string {
  return value.replace(/[\r\n]/g, '').trim();
}

export function encodeHeader(value: string): string {
  const clean = safeHeader(value);
  return /[^\x20-\x7e]/.test(clean) ? `=?UTF-8?B?${Buffer.from(clean).toString('base64')}?=` : clean;
}

export function htmlToPlainText(html: string): string {
  return html.replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n\n').replace(/<[^>]*>/g, '').replace(/\n{3,}/g, '\n\n').trim();
}

export function buildMimeMessage(fromName: string, fromEmail: string, to: string, subject: string, textBody: string, htmlBody: string) {
  const boundary = `boundary_${Date.now().toString(16)}_${Math.random().toString(16).slice(2)}`;
  const message = [
    `From: ${encodeHeader(fromName)} <${safeHeader(fromEmail)}>`,
    `To: <${safeHeader(to)}>`,
    `Subject: ${encodeHeader(subject)}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    textBody,
    '',
    `--${boundary}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    htmlBody,
    '',
    `--${boundary}--`
  ].join('\r\n');
  return Buffer.from(message).toString('base64url');
}

import ExcelJS from 'exceljs';
import { Readable } from 'stream';
import { parse as csvParse } from 'csv-parse';

export type ParsedRecipient = { email: string; name?: string; company?: string };
export type ParsedRecipientRow = { recipients: ParsedRecipient[] };

function cellToText(value: ExcelJS.CellValue | null | undefined): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value instanceof Date) return value.toISOString();
  if (typeof value !== 'object') return '';

  if ('richText' in value && Array.isArray(value.richText)) {
    return value.richText.map(part => part.text ?? '').join('');
  }
  if ('result' in value && value.result !== undefined) return cellToText(value.result);
  const parts: string[] = [];
  if ('text' in value && typeof value.text === 'string') parts.push(value.text);
  if ('hyperlink' in value && typeof value.hyperlink === 'string' && !parts.includes(value.hyperlink)) parts.push(value.hyperlink);
  return parts.join(' ');
}

const emailPattern = /[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+/gi;
const findEmails = (value: string) => value.match(emailPattern) ?? [];

export async function* parseCsvRows(stream: Readable): AsyncGenerator<ParsedRecipientRow> {
  const parser = stream.pipe(csvParse({ columns: true, bom: true, trim: true, skip_empty_lines: true }));
  for await (const row of parser) {
    const headers = Object.keys(row);
    const emailKey = headers.find(key => /e[- ]?mail/i.test(key.trim()));
    const nameKey = headers.find(key => /^(full )?name$/i.test(key.trim()));
    const companyKey = headers.find(key => /company|organization|organisation/i.test(key.trim()));
    const email = emailKey ? String(row[emailKey] ?? '').trim() : '';
    yield {
      recipients: email ? [{
        email,
        name: nameKey ? String(row[nameKey] ?? '').trim() || undefined : undefined,
        company: companyKey ? String(row[companyKey] ?? '').trim() || undefined : undefined
      }] : []
    };
  }
}

export async function* parseXlsxRows(filePath: string): AsyncGenerator<ParsedRecipientRow> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);

  for (const sheet of workbook.worksheets) {
    const rows: ExcelJS.Row[] = [];
    sheet.eachRow({ includeEmpty: false }, row => rows.push(row));
    if (!rows.length) continue;

    let headerPosition = -1;
    let emailColumn = 0;
    let nameColumn = 0;
    let companyColumn = 0;
    for (let position = 0; position < rows.length; position++) {
      const columns = new Map<number, string>();
      rows[position].eachCell({ includeEmpty: false }, (cell, column) => columns.set(column, cellToText(cell.value).trim().toLowerCase()));
      const match = [...columns.entries()].find(([, label]) => /e[- ]?mail/i.test(label));
      if (match) {
        headerPosition = position;
        emailColumn = match[0];
        nameColumn = [...columns.entries()].find(([, label]) => /^(full )?name$/.test(label))?.[0] ?? 0;
        companyColumn = [...columns.entries()].find(([, label]) => /company|organization|organisation/.test(label))?.[0] ?? 0;
        break;
      }
    }

    if (headerPosition >= 0) {
      for (const row of rows.slice(headerPosition + 1)) {
        const emailText = cellToText(row.getCell(emailColumn).value).trim();
        const email = findEmails(emailText)[0] ?? emailText;
        yield {
          recipients: email ? [{
            email,
            name: nameColumn ? cellToText(row.getCell(nameColumn).value).trim() || undefined : undefined,
            company: companyColumn ? cellToText(row.getCell(companyColumn).value).trim() || undefined : undefined
          }] : []
        };
      }
    } else {
      for (const row of rows) {
        const recipients: ParsedRecipient[] = [];
        row.eachCell({ includeEmpty: false }, cell => {
          for (const email of findEmails(cellToText(cell.value))) recipients.push({ email });
        });
        yield { recipients };
      }
    }
  }
}

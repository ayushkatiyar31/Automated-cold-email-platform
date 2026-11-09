import assert from 'node:assert/strict';
import { createReadStream } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import ExcelJS from 'exceljs';
import { parseCsvRows, parseXlsxRows } from '../src/uploadParser';

async function collectRows(rows: AsyncGenerator<{ recipients: { email: string; name?: string; company?: string }[] }>) {
  const recipients: { email: string; name?: string; company?: string }[] = [];
  for await (const row of rows) recipients.push(...row.recipients);
  return recipients;
}

async function main() {
  const xlsxPath = join(tmpdir(), `upload-parser-test-${Date.now()}.xlsx`);
  try {
    const workbook = new ExcelJS.Workbook();
    workbook.addWorksheet('Empty');
    const withHeaders = workbook.addWorksheet('Recruiters');
    withHeaders.addRow(['Full Name', 'Work Email', 'Company']);
    withHeaders.addRow([
      'Ada Lovelace',
      { text: 'Ada Lovelace', hyperlink: 'mailto:ada@example.com' },
      { richText: [{ text: 'Analytical ' }, { text: 'Engines' }] }
    ]);
    withHeaders.addRow(['Grace Hopper', { formula: '"grace@example.com"', result: 'grace@example.com' }, 'US Navy']);
    workbook.addWorksheet('No header').addRow(['Contact: noheader@example.com']);
    await workbook.xlsx.writeFile(xlsxPath);

    const xlsxRecipients = await collectRows(parseXlsxRows(xlsxPath));
    assert.deepEqual(xlsxRecipients.map(row => row.email).sort(), [
      'ada@example.com',
      'grace@example.com',
      'noheader@example.com'
    ]);
    assert.equal(xlsxRecipients.find(row => row.email === 'ada@example.com')?.company, 'Analytical Engines');

    const csvPath = resolve(process.cwd(), '..', 'sample-recruiters.csv');
    const csvRecipients = await collectRows(parseCsvRows(createReadStream(csvPath)));
    assert.equal(csvRecipients.length, 4);
    assert(csvRecipients.some(row => row.email.toLowerCase() === 'grace.hopper@example.com'));
    assert(csvRecipients.some(row => row.email === 'not-an-email'));

    console.log(`Upload parser tests passed: XLSX ${xlsxRecipients.length} recipients; CSV ${csvRecipients.length} rows.`);
  } finally {
    await unlink(xlsxPath).catch(error => {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    });
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

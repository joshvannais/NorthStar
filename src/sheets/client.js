/**
 * Google Sheets integration for lead storage.
 * Each contractor can have their own sheet.
 * Falls back silently if not configured.
 */

const { google } = require('googleapis');
const config = require('../config');

let sheetsClient = null;

function getClient() {
  if (sheetsClient) return sheetsClient;

  if (!config.sheets.clientEmail || !config.sheets.privateKey) {
    console.log('[Sheets] Not configured — skipping.');
    return null;
  }

  try {
    const auth = new google.auth.JWT(
      config.sheets.clientEmail,
      null,
      config.sheets.privateKey,
      ['https://www.googleapis.com/auth/spreadsheets']
    );

    sheetsClient = google.sheets({ version: 'v4', auth });
    return sheetsClient;
  } catch (err) {
    console.error('[Sheets] Auth error:', err.message);
    return null;
  }
}

const SHEET_HEADERS = [
  'Timestamp',
  'Lead ID',
  'Customer Name',
  'Phone Number',
  'Property Address',
  'Service Requested',
  'Preferred Date/Time',
  'Urgency',
  'Call Outcome',
  'Notes',
  'Contractor ID',
];

async function appendLead(lead, contractorId = 'default') {
  const client = getClient();
  if (!client) return;

  const spreadsheetId = config.sheets.spreadsheetId;
  if (!spreadsheetId) return;

  try {
    // Check if sheet exists and has headers
    await ensureHeaders(client, spreadsheetId, contractorId);

    const values = [[
      lead.receivedAt || new Date().toISOString(),
      lead.id || '',
      lead.customerName || '',
      lead.phoneNumber || '',
      lead.address || '',
      lead.serviceRequested || '',
      lead.preferredTime || '',
      lead.urgency || '',
      lead.callOutcome || '',
      lead.notes || '',
      contractorId,
    ]];

    await client.spreadsheets.values.append({
      spreadsheetId,
      range: `${contractorId}!A:K`,
      valueInputOption: 'USER_ENTERED',
      resource: { values },
    });

    console.log(`[Sheets] Lead ${lead.id} saved to sheet "${contractorId}"`);
  } catch (err) {
    console.error('[Sheets] Append error:', err.message);
  }
}

async function ensureHeaders(client, spreadsheetId, sheetName) {
  try {
    // Try to read the sheet
    await client.spreadsheets.values.get({
      spreadsheetId,
      range: `${sheetName}!A1:K1`,
    });
  } catch {
    // Sheet or headers don't exist — create them
    try {
      await client.spreadsheets.values.update({
        spreadsheetId,
        range: `${sheetName}!A1:K1`,
        valueInputOption: 'USER_ENTERED',
        resource: { values: [SHEET_HEADERS] },
      });
      console.log(`[Sheets] Created headers for sheet "${sheetName}"`);
    } catch (err) {
      console.error(`[Sheets] Error creating headers: ${err.message}`);
    }
  }
}

module.exports = { appendLead };
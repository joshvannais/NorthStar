/**
 * Calendar integration for scheduling estimate appointments.
 * Uses Google Calendar API.
 */

const config = require('../config');
const { google } = require('googleapis');

let calendarClient = null;

function getClient() {
  if (calendarClient) return calendarClient;

  if (!config.sheets.clientEmail || !config.sheets.privateKey) {
    console.log('[Calendar] Not configured — skipping.');
    return null;
  }

  try {
    const auth = new google.auth.JWT(
      config.sheets.clientEmail,
      null,
      config.sheets.privateKey,
      ['https://www.googleapis.com/auth/calendar']
    );

    calendarClient = google.calendar({ version: 'v3', auth });
    return calendarClient;
  } catch (err) {
    console.error('[Calendar] Auth error:', err.message);
    return null;
  }
}

/**
 * Create a calendar event for an estimate appointment.
 */
async function scheduleEstimate(lead, calendarId = 'primary') {
  const client = getClient();
  if (!client) {
    console.log('[Calendar] No client — returning mock event.');
    return { mock: true, message: `Estimate scheduled for ${lead.customerName}` };
  }

  // Parse preferred time — default to next business day 10am if not specified
  const startTime = parsePreferredTime(lead.preferredTime);
  const endTime = new Date(startTime.getTime() + 60 * 60 * 1000); // 1 hour

  try {
    const event = await client.events.insert({
      calendarId,
      resource: {
        summary: `Estimate - ${lead.customerName}`,
        description: `Service: ${lead.serviceRequested}\nPhone: ${lead.phoneNumber}\nAddress: ${lead.address}\n${lead.notes ? `Notes: ${lead.notes}` : ''}`,
        start: {
          dateTime: startTime.toISOString(),
          timeZone: 'America/New_York',
        },
        end: {
          dateTime: endTime.toISOString(),
          timeZone: 'America/New_York',
        },
        reminders: {
          useDefault: true,
        },
      },
    });

    console.log(`[Calendar] Event created: ${event.data.htmlLink}`);
    return { success: true, eventLink: event.data.htmlLink, eventId: event.data.id };
  } catch (err) {
    console.error('[Calendar] Create event error:', err.message);
    return { success: false, error: err.message };
  }
}

function parsePreferredTime(preferredTime) {
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(10, 0, 0, 0);

  if (!preferredTime) return tomorrow;

  const lower = preferredTime.toLowerCase();

  // Try to extract time
  const timeMatch = lower.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i);
  if (timeMatch) {
    let hours = parseInt(timeMatch[1], 10);
    const minutes = parseInt(timeMatch[2] || '0', 10);
    const isPM = timeMatch[3].toLowerCase() === 'pm';

    if (isPM && hours !== 12) hours += 12;
    if (!isPM && hours === 12) hours = 0;

    const dayMap = { today: 0, tomorrow: 1, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5 };
    let dayOffset = 1; // default tomorrow

    for (const [word, offset] of Object.entries(dayMap)) {
      if (lower.includes(word)) {
        dayOffset = word === 'today' ? 0 : offset;
        break;
      }
    }

    const date = new Date(now);
    date.setDate(date.getDate() + dayOffset);
    date.setHours(hours, minutes, 0, 0);
    return date;
  }

  return tomorrow;
}

module.exports = { scheduleEstimate };
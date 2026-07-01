/**
 * SMS notification service — sends lead alerts via Twilio.
 */

const config = require('../config');

let twilioClient = null;

function getClient() {
  if (twilioClient) return twilioClient;

  if (!config.twilio.accountSid || !config.twilio.authToken) {
    console.log('[SMS] Twilio not configured — skipping.');
    return null;
  }

  try {
    twilioClient = require('twilio')(
      config.twilio.accountSid,
      config.twilio.authToken
    );
    return twilioClient;
  } catch (err) {
    console.error('[SMS] Init error:', err.message);
    return null;
  }
}

function formatLeadMessage(lead) {
  let msg = `🔔 New Lead - Northstar Solutions\n\n`;
  msg += `Customer: ${lead.customerName || 'N/A'}\n`;
  msg += `Phone: ${lead.phoneNumber || 'N/A'}\n`;
  msg += `Address: ${lead.address || 'N/A'}\n`;
  msg += `Service: ${lead.serviceRequested || 'N/A'}\n`;
  msg += `Preferred: ${lead.preferredTime || 'N/A'}\n`;
  if (lead.urgency) msg += `Urgency: ${lead.urgency}\n`;
  msg += `Outcome: ${lead.callOutcome || 'Lead captured'}\n`;

  return msg;
}

async function sendLeadNotification(lead, toNumber) {
  const client = getClient();
  if (!client) return;

  const to = toNumber || config.notifications.phone;
  const from = config.twilio.phoneNumber;

  if (!to || !from) {
    console.log('[SMS] Missing to/from number — skipping.');
    return;
  }

  try {
    const message = await client.messages.create({
      body: formatLeadMessage(lead),
      from,
      to,
    });
    console.log(`[SMS] Notification sent to ${to} (SID: ${message.sid})`);
  } catch (err) {
    console.error('[SMS] Send error:', err.message);
  }
}

module.exports = { sendLeadNotification };
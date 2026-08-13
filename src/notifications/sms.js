/**
 * SMS notification service — sends lead alerts via Twilio.
 */

const config = require('../config');
const safeLogger = require('../observability/safeLogger');

let twilioClient = null;

function getClient() {
  if (twilioClient) return twilioClient;

  if (!config.twilio.accountSid || !config.twilio.authToken) {
    safeLogger.warn('twilio', 'provider_unconfigured', { configured: false });
    return null;
  }

  try {
    twilioClient = require('twilio')(
      config.twilio.accountSid,
      config.twilio.authToken
    );
    return twilioClient;
  } catch (err) {
    safeLogger.error('twilio', 'client_initialization_failed');
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

  // Operational recipients are supplied only from the tenant-scoped
  // notification_preferences projection. Environment and Business Profile
  // values are not notification authority.
  const to = typeof toNumber === 'string' ? toNumber.trim() : '';
  const from = config.twilio.phoneNumber;

  if (!to || !from) {
    safeLogger.warn('twilio', 'recipient_unavailable');
    return;
  }

  try {
    const message = await client.messages.create({
      body: formatLeadMessage(lead),
      from,
      to,
    });
    safeLogger.info('twilio', 'notification_sent');
  } catch (err) {
    safeLogger.error('twilio', 'notification_send_failed');
  }
}

module.exports = { sendLeadNotification };

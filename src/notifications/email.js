/**
 * Email notification service — sends lead alerts via SMTP.
 */

const config = require('../config');
const nodemailer = require('nodemailer');
const safeLogger = require('../observability/safeLogger');

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;

  if (!config.smtp.user || !config.smtp.pass) {
    safeLogger.warn('smtp', 'provider_unconfigured', { configured: false });
    return null;
  }

  try {
    transporter = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.port === 465,
      auth: {
        user: config.smtp.user,
        pass: config.smtp.pass,
      },
    });
    return transporter;
  } catch (err) {
    safeLogger.error('smtp', 'client_initialization_failed');
    return null;
  }
}

function formatLeadEmail(lead) {
  return {
    subject: `🔔 New Lead - ${lead.customerName || 'Unknown Caller'}`,
    html: `
      <h2>New Lead Captured</h2>
      <table style="border-collapse:collapse;width:100%;max-width:500px;">
        <tr><td style="padding:8px;border-bottom:1px solid #eee;font-weight:bold;">Customer</td><td style="padding:8px;border-bottom:1px solid #eee;">${lead.customerName || 'N/A'}</td></tr>
        <tr><td style="padding:8px;border-bottom:1px solid #eee;font-weight:bold;">Phone</td><td style="padding:8px;border-bottom:1px solid #eee;">${lead.phoneNumber || 'N/A'}</td></tr>
        <tr><td style="padding:8px;border-bottom:1px solid #eee;font-weight:bold;">Address</td><td style="padding:8px;border-bottom:1px solid #eee;">${lead.address || 'N/A'}</td></tr>
        <tr><td style="padding:8px;border-bottom:1px solid #eee;font-weight:bold;">Service</td><td style="padding:8px;border-bottom:1px solid #eee;">${lead.serviceRequested || 'N/A'}</td></tr>
        <tr><td style="padding:8px;border-bottom:1px solid #eee;font-weight:bold;">Preferred Time</td><td style="padding:8px;border-bottom:1px solid #eee;">${lead.preferredTime || 'N/A'}</td></tr>
        ${lead.urgency ? `<tr><td style="padding:8px;border-bottom:1px solid #eee;font-weight:bold;">Urgency</td><td style="padding:8px;border-bottom:1px solid #eee;color:${lead.urgency === 'high' ? 'red' : 'orange'};">${lead.urgency}</td></tr>` : ''}
        <tr><td style="padding:8px;border-bottom:1px solid #eee;font-weight:bold;">Outcome</td><td style="padding:8px;border-bottom:1px solid #eee;">${lead.callOutcome || 'Lead captured'}</td></tr>
      </table>
      <hr style="margin-top:16px;">
      <p style="color:#888;font-size:12px;">Northstar Solutions — AI Office Manager</p>
    `,
  };
}

async function sendLeadNotification(lead, toEmail) {
  const transport = getTransporter();
  if (!transport) return;

  // Operational recipients are supplied only from the tenant-scoped
  // notification_preferences projection. Environment and Business Profile
  // values are not notification authority.
  const to = typeof toEmail === 'string' ? toEmail.trim() : '';
  if (!to) {
    safeLogger.warn('smtp', 'recipient_unavailable');
    return;
  }

  try {
    const { subject, html } = formatLeadEmail(lead);
    await transport.sendMail({
      from: `"Northstar AI" <${config.smtp.user}>`,
      to,
      subject,
      html,
    });
    safeLogger.info('smtp', 'notification_sent');
  } catch (err) {
    safeLogger.error('smtp', 'notification_send_failed');
  }
}

module.exports = { sendLeadNotification };

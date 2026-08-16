require('dotenv').config();

const config = {
  port: parseInt(process.env.PORT || '3000', 10),

  auth: {
    accessSecret: process.env.AUTH_ACCESS_SECRET || process.env.JWT_SECRET,
    accessMinutes: parseInt(process.env.AUTH_ACCESS_MINUTES || '15', 10),
    refreshDays: parseInt(process.env.AUTH_REFRESH_DAYS || '30', 10),
    secureCookies: process.env.NODE_ENV === 'production',
  },

  // Retell AI
  retell: {
    apiKey: process.env.RETELL_API_KEY,
    agentId: process.env.RETELL_AGENT_ID,
    phoneNumber: process.env.RETELL_PHONE_NUMBER,
  },

  // Homepage browser Web Call. Every switch defaults closed. These flags are
  // an activation receipt, not a substitute for counsel or provider review.
  homepageWebCall: {
    enabled: process.env.HOMEPAGE_RETELL_WEB_CALL_ENABLED === 'true',
    legalApproved: process.env.HOMEPAGE_RETELL_LEGAL_APPROVED === 'true',
    providerApproved: process.env.HOMEPAGE_RETELL_PROVIDER_APPROVED === 'true',
    webhookIsolationApproved: process.env.HOMEPAGE_RETELL_WEBHOOK_ISOLATION_APPROVED === 'true',
  },

  // Twilio
  twilio: {
    accountSid: process.env.TWILIO_ACCOUNT_SID,
    authToken: process.env.TWILIO_AUTH_TOKEN,
    phoneNumber: process.env.TWILIO_PHONE_NUMBER,
  },

  // Google Sheets
  sheets: {
    privateKey: process.env.GOOGLE_SHEETS_PRIVATE_KEY
      ? process.env.GOOGLE_SHEETS_PRIVATE_KEY.replace(/\\n/g, '\n')
      : undefined,
    clientEmail: process.env.GOOGLE_SHEETS_CLIENT_EMAIL,
    spreadsheetId: process.env.GOOGLE_SHEETS_SPREADSHEET_ID,
  },

  // Email (SMTP)
  smtp: {
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },

  // Calendar
  calendar: {
    type: process.env.CALENDAR_TYPE || 'google',
    credentials: process.env.GOOGLE_CALENDAR_CREDENTIALS,
  },
};

config.validateRuntime = function validateRuntime() {
  const failures = [];
  if (!config.auth.accessSecret || Buffer.byteLength(config.auth.accessSecret, 'utf8') < 32) {
    failures.push('AUTH_ACCESS_SECRET must contain at least 32 bytes');
  }
  if (!Number.isInteger(config.auth.accessMinutes) || config.auth.accessMinutes < 1 || config.auth.accessMinutes > 60) {
    failures.push('AUTH_ACCESS_MINUTES must be an integer from 1 through 60');
  }
  if (!Number.isInteger(config.auth.refreshDays) || config.auth.refreshDays < 1 || config.auth.refreshDays > 90) {
    failures.push('AUTH_REFRESH_DAYS must be an integer from 1 through 90');
  }
  if (failures.length) throw new Error(`Invalid runtime configuration: ${failures.join('; ')}`);
  return true;
};

module.exports = config;

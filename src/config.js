require('dotenv').config();

const config = {
  port: parseInt(process.env.PORT || '3000', 10),

  auth: {
    accessSecret: process.env.AUTH_ACCESS_SECRET || process.env.JWT_SECRET,
    accessMinutes: parseInt(process.env.AUTH_ACCESS_MINUTES || '15', 10),
    refreshDays: parseInt(process.env.AUTH_REFRESH_DAYS || '30', 10),
    signupEnabled: process.env.ACCOUNT_SIGNUP_ENABLED === 'true',
    verificationDeliveryReady: process.env.ACCOUNT_VERIFICATION_DELIVERY_READY === 'true',
    secureCookies: process.env.NODE_ENV === 'production',
  },

  // Retell AI
  retell: {
    apiKey: process.env.RETELL_API_KEY,
    agentId: process.env.RETELL_AGENT_ID,
    phoneNumber: process.env.RETELL_PHONE_NUMBER,
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

  // Notifications
  notifications: {
    phone: process.env.NOTIFICATION_PHONE,
    email: process.env.NOTIFICATION_EMAIL,
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
  if (process.env.NODE_ENV === 'production' && config.auth.signupEnabled && !config.auth.verificationDeliveryReady) {
    failures.push('ACCOUNT_SIGNUP_ENABLED requires PR B verification delivery readiness in production');
  }
  if (failures.length) throw new Error(`Invalid runtime configuration: ${failures.join('; ')}`);
  return true;
};

module.exports = config;

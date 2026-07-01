require('dotenv').config();

const config = {
  port: parseInt(process.env.PORT || '3000', 10),

  // Retell AI
  retell: {
    apiKey: process.env.RETELL_API_KEY,
    agentId: process.env.RETELL_AGENT_ID,
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

module.exports = config;
'use strict';

const path = require('path');

const INVESTOR_FORECAST_PATH = '/investor/forecast';
const INVESTOR_FORECAST_FILE = path.join(
  __dirname,
  '..',
  '..',
  'public',
  'unlisted',
  'investor-forecast.html'
);

// This page is a self-contained document. Its route receives a deliberately
// narrower policy than the shared application shell: inline document code and
// a blob-backed calculation worker are allowed, while network, form, framing,
// object, and base capabilities remain unavailable.
const INVESTOR_FORECAST_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline' blob:",
  "style-src 'unsafe-inline'",
  'img-src data:',
  'worker-src blob:',
  'child-src blob:',
  "connect-src 'none'",
  "font-src 'none'",
  "media-src 'none'",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
  "manifest-src 'none'",
].join('; ');

function setInvestorForecastHeaders(_req, res, next) {
  res.setHeader('Content-Security-Policy', INVESTOR_FORECAST_CSP);
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive, nosnippet');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  next();
}

function sendInvestorForecast(_req, res) {
  res.sendFile(INVESTOR_FORECAST_FILE);
}

function requireExactInvestorForecastPath(req, _res, next) {
  if (req.path !== INVESTOR_FORECAST_PATH) return next('route');
  return next();
}

function mountInvestorForecast(app) {
  // Keep this exact direct-link route out of the public pages/discovery map.
  app.head(INVESTOR_FORECAST_PATH, requireExactInvestorForecastPath, setInvestorForecastHeaders, sendInvestorForecast);
  app.get(INVESTOR_FORECAST_PATH, requireExactInvestorForecastPath, setInvestorForecastHeaders, sendInvestorForecast);
}

module.exports = {
  INVESTOR_FORECAST_PATH,
  INVESTOR_FORECAST_FILE,
  INVESTOR_FORECAST_CSP,
  mountInvestorForecast,
};

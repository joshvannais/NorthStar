'use strict';

const commandCenterContract = require('../../public/js/command-center-contract');

const MOUNTED_THEME_PAGES = Object.freeze([
  { route: '/', file: 'public/index.html', surface: 'public' },
  ...commandCenterContract.ROUTES.map(destination => ({
    route: destination.demoPath,
    file: 'public/demo-dashboard.html',
    surface: 'public-demo',
  })),
  { route: '/login', file: 'public/login.html', surface: 'auth' },
  { route: '/signup', file: 'public/signup.html', surface: 'auth' },
  { route: '/verify-email', file: 'public/verify-email.html', surface: 'auth' },
  { route: '/forgot-password', file: 'public/forgot-password.html', surface: 'auth' },
  { route: '/reset-password', file: 'public/reset-password.html', surface: 'auth' },
  { route: '/accept-invitation', file: 'public/accept-invitation.html', surface: 'auth' },
  { route: '/account/pending', file: 'public/account/pending.html', surface: 'account' },
  { route: '/dashboard', file: 'public/dashboard/command-center.html', surface: 'dashboard' },
  { route: '/dashboard/today', file: 'public/dashboard/today.html', surface: 'dashboard' },
  { route: '/dashboard/executive-brief', file: 'public/dashboard/executive-brief.html', surface: 'dashboard' },
  { route: '/dashboard/leads', file: 'public/dashboard/leads.html', surface: 'dashboard' },
  { route: '/dashboard/communications', file: 'public/dashboard/communications.html', surface: 'dashboard' },
  { route: '/dashboard/calendar', file: 'public/dashboard/calendar.html', surface: 'dashboard' },
  { route: '/dashboard/team', file: 'public/dashboard/team.html', surface: 'dashboard' },
  { route: '/dashboard/business-profile', file: 'public/dashboard/business-profile.html', surface: 'dashboard' },
  { route: '/dashboard/settings', file: 'public/dashboard/settings.html', surface: 'dashboard' },
  { route: '/dashboard/integrations', file: 'public/dashboard/integrations.html', surface: 'dashboard' },
  { route: '/dashboard/report-a-bug', file: 'public/dashboard/report-a-bug.html', surface: 'dashboard' },
  { route: '/dashboard/lead', file: 'public/dashboard/lead.html', surface: 'dashboard' },
  { route: '/dashboard/polaris', file: 'public/dashboard/polaris.html', surface: 'dashboard' },
  { route: '/contact', file: 'public/contact.html', surface: 'public' },
  { route: '/faq', file: 'public/faq.html', surface: 'public' },
  { route: '/privacy', file: 'public/privacy.html', surface: 'public' },
  { route: '/terms', file: 'public/terms.html', surface: 'public' },
  { route: '/refund', file: 'public/refund.html', surface: 'public' },
  { route: '/legal', file: 'public/legal.html', surface: 'public' },
  { route: '/admin', file: 'public/admin.html', surface: 'unavailable' },
  { route: '/preview-dark', file: 'public/previews/dark.html', surface: 'public' },
  { route: '/preview-light', file: 'public/previews/light.html', surface: 'public' },
]);

const MOUNTED_REDIRECTS = Object.freeze([
  '/demo-dashboard',
  '/demo/ai-settings',
  '/demo/my-number',
  '/dashboard/calls',
  '/dashboard/ai-settings',
  '/dashboard/legacy',
  '/dashboard/my-number',
  '/demo-login',
]);

module.exports = { MOUNTED_THEME_PAGES, MOUNTED_REDIRECTS };

'use strict';

const NAVIGATION = Object.freeze([
  Object.freeze({ id: 'command-center', href: '/dashboard' }),
  Object.freeze({ id: 'polaris', href: '/dashboard/polaris' }),
  Object.freeze({ id: 'leads', href: '/dashboard/leads' }),
  Object.freeze({ id: 'communications', href: '/dashboard/communications' }),
  Object.freeze({ id: 'my-number', href: '/dashboard/my-number' }),
  Object.freeze({ id: 'calendar', href: '/dashboard/calendar' }),
  Object.freeze({ id: 'team', href: '/dashboard/team' }),
  Object.freeze({ id: 'ai-settings', href: '/dashboard/ai-settings' }),
  Object.freeze({ id: 'business-profile', href: '/dashboard/business-profile' }),
  Object.freeze({ id: 'settings', href: '/dashboard/settings' }),
  Object.freeze({ id: 'integrations', href: '/dashboard/integrations' }),
]);

function navigationFixture() {
  return NAVIGATION.map(item => ({ id: item.id, href: item.href }));
}

module.exports = { NAVIGATION, navigationFixture };

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const SETTINGS = path.join(ROOT, 'public', 'dashboard', 'settings.html');
const BUSINESS_PROFILE = path.join(ROOT, 'public', 'dashboard', 'business-profile.html');

describe('Mission 20 Part 2I notification preference presentation contract', () => {
  let settings;
  let businessProfile;

  beforeAll(() => {
    settings = fs.readFileSync(SETTINGS, 'utf8');
    businessProfile = fs.readFileSync(BUSINESS_PROFILE, 'utf8');
  });

  test('Settings presents every canonical notification_preferences field and keeps security email separate', () => {
    for (const id of [
      'emailEnabled', 'emailCallSummary', 'emailAppointment',
      'smsEnabled', 'smsUrgent', 'emailAddress', 'smsNumber',
    ]) {
      expect(settings.match(new RegExp(`id=["']${id}["']`, 'g'))).toHaveLength(1);
    }
    expect(settings).toContain('id="securityEmailAddress"');
    expect(settings).toMatch(/Account-security email[\s\S]*Mandatory and not controlled by operational notification preferences/i);
    expect(settings).toContain('/api/account/preferences');
  });

  test('Settings mutation is fail-closed until durable owner or admin membership is loaded', () => {
    expect(settings).toMatch(/id="saveSettingsBtn"[^>]*disabled/);
    expect(settings).toContain('id="settingsAccessStatus"');
    expect(settings).toMatch(/(?:let|var) settingsCanEdit = false;/);
    expect(settings).toMatch(/account\s*&&\s*account\.membership\s*\?\s*account\.membership\.role/);
    expect(settings).toMatch(/role === 'owner' \|\| role === 'admin'/);
    expect(settings).toMatch(/function saveSettings\(\)\s*{\s*if \(!settingsCanEdit\) return;/);
    expect(settings).toMatch(/function saveContacts\(contacts\)\s*{\s*if \(!settingsCanEdit\) return;/);
    expect(settings).toMatch(/const checkboxes = \[[^\]]*'emailEnabled'[^\]]*'emailCallSummary'[^\]]*'emailAppointment'[^\]]*'smsEnabled'[^\]]*'smsUrgent'/s);
    expect(settings).not.toMatch(/settings\.emailCallSummary = settingsState\.emailCallSummary/);
    expect(settings).not.toMatch(/settings\.emailAppointment = settingsState\.emailAppointment/);
    expect(settings).not.toMatch(/settings\.smsUrgent = settingsState\.smsUrgent/);
  });

  test('every canonical notification toggle is named by its visible heading', () => {
    for (const [inputId, labelId, label] of [
      ['emailEnabled', 'emailEnabledLabel', 'Email for new leads'],
      ['emailCallSummary', 'emailCallSummaryLabel', 'Email call summaries'],
      ['emailAppointment', 'emailAppointmentLabel', 'Email appointments'],
      ['smsEnabled', 'smsEnabledLabel', 'SMS for new leads'],
      ['smsUrgent', 'smsUrgentLabel', 'Urgent SMS alerts'],
    ]) {
      expect(settings).toContain(`<h4 id="${labelId}">${label}</h4>`);
      expect(settings).toMatch(new RegExp(`id=["']${inputId}["'][^>]*aria-labelledby=["']${labelId}["']`));
    }
  });

  test('Business Profile retires notification toggles while preserving the untouched legacy object', () => {
    expect(businessProfile).toContain('id="canonicalNotificationsLink"');
    expect(businessProfile).toContain('href="/dashboard/settings"');
    expect(businessProfile).toMatch(/legacy notification values are preserved/i);
    expect(businessProfile).not.toMatch(/id="notif-/);
    expect(businessProfile).not.toMatch(/setCheck\('notif-/);
    expect(businessProfile).not.toMatch(/p\.notifications\.[A-Za-z]+\s*=\s*getCheck/);
    expect(businessProfile).toMatch(/function collectProfile\(\)[\s\S]*JSON\.parse\(JSON\.stringify\(profileData \|\| \{\}\)\)/);
  });
});

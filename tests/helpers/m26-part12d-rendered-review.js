'use strict';

const assert = require('node:assert/strict');

const MISSION_26_FIVE_LAYOUTS = Object.freeze([
  Object.freeze({ name: 'phone-narrow-dark', width: 360, height: 800, colorScheme: 'dark' }),
  Object.freeze({ name: 'phone-standard-light', width: 390, height: 844, colorScheme: 'light' }),
  Object.freeze({ name: 'tablet-portrait-dark', width: 768, height: 1024, colorScheme: 'dark' }),
  Object.freeze({ name: 'tablet-landscape-light', width: 1024, height: 768, colorScheme: 'light' }),
  Object.freeze({ name: 'desktop-dark', width: 1440, height: 900, colorScheme: 'dark' }),
]);

async function auditRenderedPage(page, { mainSelector, layout }) {
  const audit = await page.evaluate(({ selector, expectedTheme }) => {
    const root = document.documentElement;
    const interactiveSelector = [
      'a[href]', 'button', 'input:not([type="hidden"])', 'select', 'textarea',
      'summary', '[role="button"]', '[tabindex]:not([tabindex="-1"])',
    ].join(',');
    const isRendered = element => {
      if (element.hidden || element.closest('[hidden], [aria-hidden="true"]')) return false;
      for (let current = element; current; current = current.parentElement) {
        const style = getComputedStyle(current);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
      }
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };
    const accessibleName = element => {
      const labelledBy = element.getAttribute('aria-labelledby');
      if (labelledBy) {
        const value = labelledBy.split(/\s+/).map(id => document.getElementById(id)?.textContent || '').join(' ').trim();
        if (value) return value;
      }
      const id = element.id;
      const label = id ? document.querySelector(`label[for="${CSS.escape(id)}"]`) : null;
      return (element.getAttribute('aria-label') || element.getAttribute('title') ||
        label?.textContent || element.textContent || element.value || '').trim();
    };
    const controls = Array.from(document.querySelectorAll(interactiveSelector)).filter(isRendered);
    const unnamed = controls.filter(element => !accessibleName(element)).map(element =>
      `${element.tagName.toLowerCase()}#${element.id || '(no-id)'}`);
    const clipped = controls.filter(element => {
      const rect = element.getBoundingClientRect();
      if (rect.right <= 0 || rect.left >= innerWidth) return false;
      return rect.left < -1 || rect.right > innerWidth + 1;
    }).map(element => `${element.tagName.toLowerCase()}#${element.id || '(no-id)'}`);
    const ids = Array.from(document.querySelectorAll('[id]')).map(element => element.id);
    const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
    const main = document.querySelector(selector);
    return {
      theme: root.getAttribute('data-theme'),
      overflow: root.scrollWidth - innerWidth,
      unnamed,
      clipped,
      duplicates: Array.from(new Set(duplicates)),
      mainExists: Boolean(main),
      mainTabIndex: main ? main.getAttribute('tabindex') : null,
      reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
      expectedTheme,
    };
  }, { selector: mainSelector, expectedTheme: layout.colorScheme });
  assert.equal(audit.theme, layout.colorScheme, `theme mismatch: ${JSON.stringify(audit)}`);
  assert.ok(audit.overflow <= 1, `horizontal overflow: ${JSON.stringify(audit)}`);
  assert.deepEqual(audit.unnamed, [], `unnamed controls: ${JSON.stringify(audit)}`);
  assert.deepEqual(audit.clipped, [], `clipped controls: ${JSON.stringify(audit)}`);
  assert.deepEqual(audit.duplicates, [], `duplicate ids: ${JSON.stringify(audit)}`);
  assert.equal(audit.mainExists, true, `missing main landmark: ${mainSelector}`);
  assert.equal(audit.mainTabIndex, '-1', `skip target must accept focus: ${mainSelector}`);
  assert.equal(audit.reducedMotion, true);
  return audit;
}

async function exerciseSkipLink(page, { skipSelector = '.skip-link', mainSelector }) {
  const skip = page.locator(skipSelector).first();
  async function reloadToNeutralDocumentFocus(forcedColors) {
    await page.emulateMedia({ forcedColors, reducedMotion: 'reduce' });
    await page.reload({ waitUntil: 'load' });
    await page.evaluate(() => {
      const previousTabIndex = document.body.getAttribute('tabindex');
      document.body.setAttribute('tabindex', '-1');
      document.body.focus({ preventScroll: true });
      if (previousTabIndex === null) document.body.removeAttribute('tabindex');
      else document.body.setAttribute('tabindex', previousTabIndex);
    });
    assert.equal(await page.evaluate(() => document.activeElement === document.body), true,
      'skip-link proof must begin from neutral document body focus');
    assert.equal(await skip.evaluate(element => element === document.activeElement), false);
  }
  async function tabToSkip(forcedColors) {
    await reloadToNeutralDocumentFocus(forcedColors);
    await page.keyboard.press('Tab');
    const focus = await page.evaluate(() => ({ tag: document.activeElement?.tagName || null,
      id: document.activeElement?.id || null,
      className: typeof document.activeElement?.className === 'string' ? document.activeElement.className : null,
      text: document.activeElement?.textContent?.trim().slice(0, 80) || null }));
    assert.equal(await skip.evaluate(element => element === document.activeElement), true,
      `skip link must be the first genuine keyboard Tab target; focused ${JSON.stringify(focus)}`);
  }
  await tabToSkip('none');
  assert.equal(await skip.evaluate(element => element === document.activeElement), true);
  const focusStyle = await skip.evaluate(element => {
    const style = getComputedStyle(element);
    return { top: style.top, outlineWidth: style.outlineWidth, boxShadow: style.boxShadow };
  });
  assert.notEqual(focusStyle.top, '-100%');
  await page.keyboard.press('Enter');
  await page.waitForFunction(selector => document.activeElement === document.querySelector(selector), mainSelector);
  await tabToSkip('active');
  assert.equal(await page.evaluate(() => matchMedia('(forced-colors: active)').matches), true);
  assert.notEqual(await skip.evaluate(element => getComputedStyle(element).top), '-100%');
  await page.keyboard.press('Enter');
  await page.waitForFunction(selector => document.activeElement === document.querySelector(selector), mainSelector);
  await page.emulateMedia({ forcedColors: 'none', reducedMotion: 'reduce' });
}

module.exports = { MISSION_26_FIVE_LAYOUTS, auditRenderedPage, exerciseSkipLink };

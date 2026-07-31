'use strict';

const assert = require('assert');
const fs = require('fs');

const DEFAULT_PLAYWRIGHT_CORE =
  'C:/Users/joshv/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright-core';
const DEFAULT_CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

function resolveBrowserRuntime(selected) {
  assert.ok(selected === 'chrome' || selected === 'webkit', 'browser must be chrome or webkit');
  const playwrightCore = process.env.NORTHSTAR_PLAYWRIGHT_CORE_PATH || DEFAULT_PLAYWRIGHT_CORE;
  assert.ok(fs.existsSync(playwrightCore), `Playwright Core is unavailable: ${playwrightCore}`);
  const { chromium, webkit } = require(playwrightCore);
  const browserType = selected === 'chrome' ? chromium : webkit;
  const executablePath = selected === 'chrome'
    ? (process.env.NORTHSTAR_CHROME_EXECUTABLE || DEFAULT_CHROME)
    : (process.env.NORTHSTAR_WEBKIT_EXECUTABLE || webkit.executablePath());
  assert.ok(
    executablePath && fs.existsSync(executablePath),
    `${selected} executable is unavailable: ${executablePath || 'not configured'}`
  );
  return { browserType, executablePath };
}

module.exports = { resolveBrowserRuntime };

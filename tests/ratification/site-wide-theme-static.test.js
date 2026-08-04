'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { MOUNTED_THEME_PAGES } = require('../helpers/site-theme-pages');

const ROOT = path.resolve(__dirname, '../..');
const PUBLIC = path.join(ROOT, 'public');

function occurrences(source, expression) {
  return (source.match(expression) || []).length;
}

function localAsset(attribute) {
  if (!attribute.startsWith('/') || attribute.startsWith('//')) return null;
  if (!/^\/(?:css|js|assets)\//.test(attribute)) return null;
  return path.join(PUBLIC, attribute.slice(1).replace(/\//g, path.sep));
}

describe('site-wide theme static structure', () => {
  test.each(MOUNTED_THEME_PAGES)('$file has one complete HTML document and parseable inline scripts', page => {
    const html = fs.readFileSync(path.join(ROOT, page.file), 'utf8');
    expect(html).toMatch(/^<!DOCTYPE html>/i);
    expect(occurrences(html, /<html\b/gi)).toBe(1);
    expect(occurrences(html, /<\/html>/gi)).toBe(1);
    expect(occurrences(html, /<head\b/gi)).toBe(1);
    expect(occurrences(html, /<\/head>/gi)).toBe(1);
    expect(occurrences(html, /<body\b/gi)).toBe(1);
    expect(occurrences(html, /<\/body>/gi)).toBe(1);

    const inlineScripts = Array.from(html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi))
      .filter(match => !/\bsrc\s*=/i.test(match[1]) && !/\btype\s*=\s*["']application\/json["']/i.test(match[1]));
    inlineScripts.forEach((match, index) => {
      expect(() => new vm.Script(match[2], { filename: `${page.file}:inline-${index + 1}` })).not.toThrow();
    });

    const assetReferences = Array.from(html.matchAll(/\b(?:src|href)=["']([^"']+)["']/gi))
      .map(match => localAsset(match[1]))
      .filter(Boolean);
    assetReferences.forEach(asset => expect(fs.statSync(asset).isFile()).toBe(true));
  });

  test('the shared stylesheet contains only resolvable local absolute asset URLs', () => {
    const css = fs.readFileSync(path.join(PUBLIC, 'css/style.css'), 'utf8');
    const references = Array.from(css.matchAll(/url\(\s*["']?(\/[^"')]+)["']?\s*\)/gi))
      .map(match => path.join(PUBLIC, match[1].slice(1).replace(/\//g, path.sep)));
    references.forEach(asset => expect(fs.statSync(asset).isFile()).toBe(true));
  });
});

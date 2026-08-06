'use strict';

const assert = require('assert');

const DECORATIVE_SELECTORS = Object.freeze([
  '[aria-hidden="true"]',
  '.hero-logo-bg',
  '.verification-mark',
  '.card-icon',
  '.stat-icon',
  '.empty-state-icon',
  '.error-state-icon',
  '.cc-kpi-icon',
  '.cc-pipe-icon',
  '.ds-kpi-icon',
  '.ds-list-item-icon',
]);

async function auditMountedAccessibility(page) {
  return page.evaluate(({ decorativeSelectors }) => {
    const interactiveSelector = 'a[href], button, input:not([type="hidden"]), select, textarea, [role="button"], [tabindex]:not([tabindex="-1"])';
    const decorativeSelector = decorativeSelectors.join(',');

    function parseColor(value) {
      if (!value || value === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
      const rgb = value.match(/^rgba?\(\s*([\d.]+)[, ]+\s*([\d.]+)[, ]+\s*([\d.]+)(?:\s*[,/]\s*([\d.]+))?\s*\)$/i);
      if (rgb) {
        return { r: Number(rgb[1]), g: Number(rgb[2]), b: Number(rgb[3]), a: rgb[4] === undefined ? 1 : Number(rgb[4]) };
      }
      const hex = value.match(/^#([\da-f]{6})([\da-f]{2})?$/i);
      if (hex) {
        return {
          r: parseInt(hex[1].slice(0, 2), 16),
          g: parseInt(hex[1].slice(2, 4), 16),
          b: parseInt(hex[1].slice(4, 6), 16),
          a: hex[2] ? parseInt(hex[2], 16) / 255 : 1,
        };
      }
      return null;
    }

    function composite(foreground, background) {
      const alpha = foreground.a + (background.a * (1 - foreground.a));
      if (alpha === 0) return { r: 0, g: 0, b: 0, a: 0 };
      return {
        r: ((foreground.r * foreground.a) + (background.r * background.a * (1 - foreground.a))) / alpha,
        g: ((foreground.g * foreground.a) + (background.g * background.a * (1 - foreground.a))) / alpha,
        b: ((foreground.b * foreground.a) + (background.b * background.a * (1 - foreground.a))) / alpha,
        a: alpha,
      };
    }

    function luminance(color) {
      const channels = [color.r, color.g, color.b].map(channel => {
        const normalized = channel / 255;
        return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
      });
      return (0.2126 * channels[0]) + (0.7152 * channels[1]) + (0.0722 * channels[2]);
    }

    function contrast(first, second) {
      const firstLuminance = luminance(first);
      const secondLuminance = luminance(second);
      return (Math.max(firstLuminance, secondLuminance) + 0.05) / (Math.min(firstLuminance, secondLuminance) + 0.05);
    }

    function colorLabel(color) {
      return `rgb(${Math.round(color.r)}, ${Math.round(color.g)}, ${Math.round(color.b)})`;
    }

    function uniqueColors(colors) {
      const seen = new Set();
      return colors.filter(color => {
        const key = `${Math.round(color.r)},${Math.round(color.g)},${Math.round(color.b)},${color.a.toFixed(3)}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      }).slice(0, 16);
    }

    function gradientColors(style) {
      if (!style.backgroundImage || style.backgroundImage === 'none') return [];
      return Array.from(style.backgroundImage.matchAll(/rgba?\([^)]*\)|#[\da-f]{6}(?:[\da-f]{2})?/gi))
        .map(match => parseColor(match[0]))
        .filter(Boolean);
    }

    function backgroundCandidates(element) {
      const chain = [];
      for (let current = element; current; current = current.parentElement) chain.unshift(current);
      let candidates = [{ r: 255, g: 255, b: 255, a: 1 }];
      for (const current of chain) {
        const style = getComputedStyle(current);
        const background = parseColor(style.backgroundColor) || { r: 0, g: 0, b: 0, a: 0 };
        const gradients = gradientColors(style);
        const next = [];
        for (const existing of candidates) {
          const surface = composite(background, existing);
          if (gradients.length === 0) next.push(surface);
          else for (const gradient of gradients) next.push(composite(gradient, surface));
        }
        candidates = uniqueColors(next);
      }
      return candidates;
    }

    function inheritedOpacity(element) {
      let opacity = 1;
      for (let current = element; current; current = current.parentElement) {
        const value = Number(getComputedStyle(current).opacity);
        if (Number.isFinite(value)) opacity *= value;
      }
      return opacity;
    }

    function contrastResult(element, pseudo = null) {
      const style = getComputedStyle(element, pseudo);
      const rawForeground = parseColor(style.color);
      const backgrounds = backgroundCandidates(element);
      if (!rawForeground || backgrounds.length === 0) return null;
      const opacity = inheritedOpacity(element) * (pseudo && Number.isFinite(Number(style.opacity)) ? Number(style.opacity) : 1);
      const ratios = backgrounds.map(background => {
        const foreground = composite({ ...rawForeground, a: rawForeground.a * opacity }, background);
        return { ratio: contrast(foreground, background), foreground, background };
      });
      return ratios.sort((a, b) => a.ratio - b.ratio)[0];
    }

    function isVisible(element) {
      if (element.matches('.skip-link') && !element.matches(':focus')) return false;
      for (let current = element; current; current = current.parentElement) {
        const ancestorStyle = getComputedStyle(current);
        if (ancestorStyle.display === 'none' || ancestorStyle.visibility === 'hidden' || Number(ancestorStyle.opacity) <= 0) return false;
      }
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none'
        && style.visibility !== 'hidden'
        && Number(style.opacity) > 0
        && rect.width > 0
        && rect.height > 0;
    }

    function isDecorative(element) {
      if (element.matches(decorativeSelector) || element.closest(decorativeSelector)) return true;
      const className = typeof element.className === 'string' ? element.className : '';
      const directText = Array.from(element.childNodes)
        .filter(node => node.nodeType === Node.TEXT_NODE)
        .map(node => node.textContent)
        .join('')
        .trim();
      return directText !== '' && !/[\p{L}\p{N}]/u.test(directText)
        || /(?:icon|mark|logo)/i.test(className) && directText !== '' && !/[\p{L}\p{N}]/u.test(directText);
    }

    function pathFor(element) {
      if (element.id) return `#${element.id}`;
      const parts = [];
      for (let current = element; current && current !== document.body && parts.length < 4; current = current.parentElement) {
        const classes = typeof current.className === 'string'
          ? current.className.trim().split(/\s+/).filter(Boolean).slice(0, 2).map(value => `.${value}`).join('')
          : '';
        parts.unshift(`${current.tagName.toLowerCase()}${classes}`);
      }
      return parts.join(' > ');
    }

    function thresholdFor(element) {
      const style = getComputedStyle(element);
      const fontSize = parseFloat(style.fontSize);
      const fontWeight = Number(style.fontWeight) || (/bold/i.test(style.fontWeight) ? 700 : 400);
      return fontSize >= 24 || (fontSize >= 18.66 && fontWeight >= 700) ? 3 : 4.5;
    }

    function failure(element, result, threshold, kind, text) {
      return {
        kind,
        path: pathFor(element),
        text: String(text || '').replace(/\s+/g, ' ').trim().slice(0, 80),
        ratio: Number(result.ratio.toFixed(3)),
        threshold,
        foreground: colorLabel(result.foreground),
        background: colorLabel(result.background),
      };
    }

    const contrastFailures = [];
    let auditedTextElements = 0;
    const elements = [document.body, ...document.body.querySelectorAll('*')];
    for (const element of elements) {
      if (!isVisible(element) || isDecorative(element) || element.matches('script, style, noscript, template, option')) continue;
      const text = Array.from(element.childNodes)
        .filter(node => node.nodeType === Node.TEXT_NODE)
        .map(node => node.textContent)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (text) {
        auditedTextElements += 1;
        const result = contrastResult(element);
        const threshold = thresholdFor(element);
        if (result && result.ratio + 0.005 < threshold) contrastFailures.push(failure(element, result, threshold, 'text', text));
      }

      if (element.matches('input[placeholder], textarea[placeholder]')) {
        auditedTextElements += 1;
        const result = contrastResult(element, '::placeholder');
        if (result && result.ratio + 0.005 < 4.5) {
          contrastFailures.push(failure(element, result, 4.5, 'placeholder', element.getAttribute('placeholder')));
        }
      }

      if (element.matches('input[type="button"], input[type="submit"]')) {
        auditedTextElements += 1;
        const result = contrastResult(element);
        if (result && result.ratio + 0.005 < 4.5) {
          contrastFailures.push(failure(element, result, 4.5, 'control-text', element.value));
        }
      }

      const hasSafeRenderedValue = element.matches('select')
        || element.matches('textarea') && element.value !== ''
        || element.matches('input:not([type="hidden"]):not([type="button"]):not([type="submit"]):not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="color"])') && element.value !== '';
      if (hasSafeRenderedValue) {
        auditedTextElements += 1;
        const result = contrastResult(element);
        if (result && result.ratio + 0.005 < 4.5) {
          contrastFailures.push(failure(element, result, 4.5, 'control-value', '[rendered control value]'));
        }
      }
    }

    const uiFailures = [];
    for (const element of document.querySelectorAll(interactiveSelector)) {
      if (!isVisible(element) || isDecorative(element)) continue;
      const text = (element.innerText || element.value || element.getAttribute('aria-label') || '').trim();
      if (element.matches('input:not([type="hidden"]), select, textarea')) {
        const outside = backgroundCandidates(element.parentElement || document.body);
        const surface = backgroundCandidates(element);
        const style = getComputedStyle(element);
        const border = parseColor(style.borderColor) || { r: 0, g: 0, b: 0, a: 0 };
        const surfaceContrast = Math.min(...surface.flatMap(color => outside.map(background => contrast(color, background))));
        const borderContrast = Math.min(...outside.map(background => contrast(composite(border, background), background)));
        const signal = Math.max(surfaceContrast, borderContrast);
        if (signal + 0.005 < 3) {
          uiFailures.push({ kind: 'field-boundary', path: pathFor(element), ratio: Number(signal.toFixed(3)), threshold: 3 });
        }
      } else if (!/[\p{L}\p{N}]/u.test(text)) {
        const result = contrastResult(element);
        if (result && result.ratio + 0.005 < 3) {
          uiFailures.push(failure(element, result, 3, 'graphical-control', element.getAttribute('aria-label') || text));
        }
      }
    }

    const toggle = document.querySelector('[data-northstar-theme-toggle]');
    const toggleRect = toggle && toggle.getBoundingClientRect();
    const overlaps = [];
    const clipped = [];
    const seenOverlaps = new Set();
    for (const element of document.querySelectorAll(interactiveSelector)) {
      if (!isVisible(element) || element === toggle || element.closest('[data-northstar-theme-control]')) continue;
      const rect = element.getBoundingClientRect();
      const intersectsViewport = rect.right > 0 && rect.left < innerWidth && rect.bottom > 0 && rect.top < innerHeight;
      if (!intersectsViewport) continue;
      if (rect.left < -0.5 || rect.right > innerWidth + 0.5) clipped.push({ path: pathFor(element), left: Math.round(rect.left), right: Math.round(rect.right) });
      if (toggleRect) {
        const width = Math.min(rect.right, toggleRect.right) - Math.max(rect.left, toggleRect.left);
        const height = Math.min(rect.bottom, toggleRect.bottom) - Math.max(rect.top, toggleRect.top);
        if (width > 0.5 && height > 0.5) {
          const key = pathFor(element);
          if (!seenOverlaps.has(key)) {
            seenOverlaps.add(key);
            overlaps.push({ path: key, width: Math.round(width), height: Math.round(height) });
          }
        }
      }
    }

    return {
      contrastFailures,
      uiFailures,
      overlaps,
      clipped,
      decorativeExclusions: decorativeSelectors,
      decorativeTextPolicy: 'standalone glyphs without letters or numbers',
      auditedTextElements,
    };
  }, { decorativeSelectors: DECORATIVE_SELECTORS });
}

async function focusIndicatorEvidence(locator) {
  return locator.evaluate(element => {
    function parseColor(value) {
      const match = value && value.match(/rgba?\(\s*([\d.]+)[, ]+\s*([\d.]+)[, ]+\s*([\d.]+)(?:\s*[,/]\s*([\d.]+))?/i);
      return match
        ? { r: Number(match[1]), g: Number(match[2]), b: Number(match[3]), a: match[4] === undefined ? 1 : Number(match[4]) }
        : null;
    }
    function composite(foreground, background) {
      const alpha = foreground.a + (background.a * (1 - foreground.a));
      return {
        r: ((foreground.r * foreground.a) + (background.r * background.a * (1 - foreground.a))) / alpha,
        g: ((foreground.g * foreground.a) + (background.g * background.a * (1 - foreground.a))) / alpha,
        b: ((foreground.b * foreground.a) + (background.b * background.a * (1 - foreground.a))) / alpha,
        a: alpha,
      };
    }
    function luminance(color) {
      const channels = [color.r, color.g, color.b].map(channel => {
        const value = channel / 255;
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
      });
      return (0.2126 * channels[0]) + (0.7152 * channels[1]) + (0.0722 * channels[2]);
    }
    function ratio(first, second) {
      const firstLuminance = luminance(first);
      const secondLuminance = luminance(second);
      return (Math.max(firstLuminance, secondLuminance) + 0.05) / (Math.min(firstLuminance, secondLuminance) + 0.05);
    }

    const style = getComputedStyle(element);
    const outline = parseColor(style.outlineColor);
    const ringMatch = style.boxShadow && style.boxShadow.match(/rgba?\([^)]*\)/i);
    const ring = parseColor(ringMatch && ringMatch[0]);
    let backgrounds = [{ r: 255, g: 255, b: 255, a: 1 }];
    const chain = [];
    for (let current = element.parentElement; current; current = current.parentElement) chain.unshift(current);
    for (const current of chain) {
      const color = parseColor(getComputedStyle(current).backgroundColor);
      if (color && color.a > 0) backgrounds = backgrounds.map(background => composite(color, background));
    }
    const contrast = outline ? Math.min(...backgrounds.map(background => ratio(outline, background))) : 0;
    const ringContrast = ring ? Math.min(...backgrounds.map(background => ratio(ring, background))) : 0;
    const matchedFocusRules = [];
    for (const sheet of document.styleSheets) {
      let rules;
      try { rules = sheet.cssRules; } catch (_error) { continue; }
      for (const rule of rules) {
        if (!rule.selectorText || !rule.selectorText.includes('focus')) continue;
        try {
          if (element.matches(rule.selectorText)) matchedFocusRules.push({ selector: rule.selectorText, outline: rule.style.outline });
        } catch (_error) {}
      }
    }
    return {
      active: document.activeElement === element,
      focusVisible: element.matches(':focus-visible'),
      outlineStyle: style.outlineStyle,
      outlineWidth: parseFloat(style.outlineWidth) || 0,
      outline: style.outline,
      outlineColor: style.outlineColor,
      boxShadow: style.boxShadow,
      themeFocus: getComputedStyle(document.documentElement).getPropertyValue('--theme-focus').trim(),
      elementThemeFocus: style.getPropertyValue('--theme-focus').trim(),
      matchedFocusRules,
      contrast: Number(contrast.toFixed(3)),
      ringContrast: Number(ringContrast.toFixed(3)),
      signalContrast: Number(Math.max(contrast, ringContrast).toFixed(3)),
    };
  });
}

async function interactiveTransitionFractions(locator) {
  const animationCount = await locator.evaluate(element => {
    getComputedStyle(element).color;
    return element.getAnimations({ subtree: true }).filter(animation => {
      const timing = animation.effect && animation.effect.getComputedTiming();
      return timing && Number.isFinite(Number(timing.endTime)) && Number(timing.endTime) > 0;
    }).length;
  });
  return animationCount > 0 ? [0, 0.25, 0.5, 0.75, 1] : [1];
}

async function setInteractiveTransitionProgress(locator, progress) {
  return locator.evaluate((element, requestedProgress) => {
    getComputedStyle(element).color;
    const animations = element.getAnimations({ subtree: true }).filter(animation => {
      const timing = animation.effect && animation.effect.getComputedTiming();
      return timing && Number.isFinite(Number(timing.endTime)) && Number(timing.endTime) > 0;
    });
    for (const animation of animations) {
      const endTime = Number(animation.effect.getComputedTiming().endTime);
      animation.pause();
      animation.currentTime = endTime * requestedProgress;
    }
    getComputedStyle(element).color;
    return {
      progress: requestedProgress,
      animations: animations.length,
      properties: animations.map(animation => animation.transitionProperty || animation.animationName || animation.constructor.name),
    };
  }, progress);
}

async function releaseInteractiveState(page, locator) {
  await locator.evaluate(element => {
    for (const animation of element.getAnimations({ subtree: true })) animation.cancel();
  });
  await page.mouse.move(1, 1);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await locator.evaluate(element => {
    for (const animation of element.getAnimations({ subtree: true })) {
      const timing = animation.effect && animation.effect.getComputedTiming();
      if (timing && Number.isFinite(Number(timing.endTime))) {
        animation.pause();
        animation.currentTime = Number(timing.endTime);
      }
    }
    getComputedStyle(element).color;
  });
}

function hasAccessibilityFailure(audit) {
  return audit.contrastFailures.length || audit.uiFailures.length || audit.overlaps.length
    || audit.clipped.length;
}

async function auditInteractiveStates(page) {
  const selector = 'a[href], button, input:not([type="hidden"]), select, textarea, [role="button"], [tabindex]:not([tabindex="-1"])';
  const contexts = await page.locator(selector).evaluateAll(elements => {
    const rows = [];
    elements.forEach((element, index) => {
      const rect = element.getBoundingClientRect();
      let visible = rect.width > 0 && rect.height > 0 && rect.right > 0 && rect.left < innerWidth;
      for (let current = element; visible && current; current = current.parentElement) {
        const style = getComputedStyle(current);
        if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) <= 0) visible = false;
      }
      if (!visible || element.matches('.skip-link')) return;
      const className = typeof element.className === 'string' ? element.className.trim().replace(/\s+/g, '.') : '';
      const href = element.getAttribute('href');
      let safeHref = '';
      if (href) {
        try { safeHref = new URL(href, location.origin).pathname; } catch (_error) { safeHref = '[invalid]'; }
      }
      const ancestors = [];
      for (let current = element.parentElement; current && ancestors.length < 4; current = current.parentElement) {
        const style = getComputedStyle(current);
        const currentClass = typeof current.className === 'string'
          ? current.className.trim().split(/\s+/).filter(Boolean).slice(0, 3).join('.')
          : '';
        ancestors.push([
          current.tagName,
          current.id || '',
          currentClass,
          style.backgroundColor,
          style.backgroundImage,
        ].join(':'));
      }
      const signature = [
        element.tagName,
        element.getAttribute('type') || '',
        element.getAttribute('role') || '',
        element.id || '',
        className,
        safeHref,
        element.disabled ? 'disabled' : 'enabled',
        ancestors.join('>'),
      ].join('|');
      rows.push({ index, signature, disabled: Boolean(element.disabled) });
    });
    return rows;
  });

  const hoverFailures = [];
  const focusFailures = [];
  let hoverFrames = 0;
  let focusFrames = 0;
  const all = page.locator(selector);
  for (const context of contexts) {
    const locator = all.nth(context.index);
    await locator.scrollIntoViewIfNeeded();
    await locator.hover({ force: true });
    const hoverFractions = await interactiveTransitionFractions(locator);
    for (const fraction of hoverFractions) {
      const transition = await setInteractiveTransitionProgress(locator, fraction);
      const hoverAudit = await auditMountedAccessibility(page);
      hoverFrames += 1;
      if (hasAccessibilityFailure(hoverAudit)) {
        hoverFailures.push({
          signature: context.signature,
          phase: `hover-${fraction}`,
          transition,
          contrastFailures: hoverAudit.contrastFailures.slice(0, 8),
          uiFailures: hoverAudit.uiFailures.slice(0, 8),
          overlaps: hoverAudit.overlaps,
          clipped: hoverAudit.clipped,
        });
      }
    }
    await releaseInteractiveState(page, locator);

    if (!context.disabled) {
      await page.keyboard.press('Tab');
      await locator.focus();
      const focusFractions = await interactiveTransitionFractions(locator);
      for (const fraction of focusFractions) {
        const transition = await setInteractiveTransitionProgress(locator, fraction);
        const focus = await focusIndicatorEvidence(locator);
        const focusAudit = await auditMountedAccessibility(page);
        focusFrames += 1;
        if (!focus.active || !focus.focusVisible || focus.outlineStyle === 'none' || focus.outlineWidth < 2
          || focus.signalContrast < 3 || hasAccessibilityFailure(focusAudit)) {
          focusFailures.push({
            signature: context.signature,
            phase: `focus-${fraction}`,
            transition,
            focus,
            contrastFailures: focusAudit.contrastFailures.slice(0, 8),
            uiFailures: focusAudit.uiFailures.slice(0, 8),
            overlaps: focusAudit.overlaps,
            clipped: focusAudit.clipped,
          });
        }
      }
      await locator.evaluate(element => {
        for (const animation of element.getAnimations({ subtree: true })) animation.cancel();
        element.blur();
      });
    }
  }
  await page.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); });
  await page.evaluate(() => scrollTo(0, 0));
  return {
    groups: contexts.length,
    visibleControlContexts: contexts.length,
    hoverFrames,
    focusFrames,
    hoverFailures,
    focusFailures,
  };
}

function assertAccessibilityAudit(audit, label) {
  assert.deepStrictEqual(audit.contrastFailures, [], `${label} contrast failures: ${JSON.stringify(audit.contrastFailures.slice(0, 40))}`);
  assert.deepStrictEqual(audit.uiFailures, [], `${label} UI contrast failures: ${JSON.stringify(audit.uiFailures.slice(0, 40))}`);
  assert.deepStrictEqual(audit.overlaps, [], `${label} theme control intersections: ${JSON.stringify(audit.overlaps)}`);
  assert.deepStrictEqual(audit.clipped, [], `${label} clipped controls: ${JSON.stringify(audit.clipped)}`);
}

module.exports = {
  DECORATIVE_SELECTORS,
  auditMountedAccessibility,
  auditInteractiveStates,
  assertAccessibilityAudit,
  interactiveTransitionFractions,
  setInteractiveTransitionProgress,
  releaseInteractiveState,
};

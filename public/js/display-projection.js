(function (global) {
  'use strict';

  function markupLike(value) {
    var text = typeof value === 'string' ? value : '';
    var tag = /<\s*\/?\s*[a-z!][^>]*>/i;
    var eventAttribute = /(?:^|[\s"'`<])on([a-z][a-z0-9_-]*)\s*=/ig;
    var eventNames = (
      'abort afterprint animationcancel animationend animationiteration animationstart auxclick ' +
      'beforeinput beforematch beforeprint beforetoggle beforeunload blur cancel canplay canplaythrough ' +
      'change click close command contextlost contextmenu contextrestored copy cuechange cut dblclick drag ' +
      'dragend dragenter dragleave dragover dragstart drop durationchange emptied ended error focus focusin ' +
      'focusout formdata fullscreenchange fullscreenerror gotpointercapture hashchange input invalid keydown ' +
      'keypress keyup languagechange load loadeddata loadedmetadata loadstart lostpointercapture message ' +
      'messageerror mousedown mouseenter mouseleave mousemove mouseout mouseover mouseup mousewheel offline ' +
      'online pagehide pagereveal pageshow pageswap paste pause play playing pointercancel pointerdown ' +
      'pointerenter pointerleave pointermove pointerout pointerover pointerrawupdate pointerup popstate progress ' +
      'ratechange rejectionhandled reset resize scroll scrollend securitypolicyviolation seeked seeking select ' +
      'selectionchange selectstart slotchange stalled storage submit suspend timeupdate toggle touchcancel ' +
      'touchend touchmove touchstart transitioncancel transitionend transitionrun transitionstart unload ' +
      'unhandledrejection visibilitychange volumechange waiting wheel'
    ).split(' ');
    var executableScheme = /(?:javascript|vbscript)\s*:/i;
    var markupDataScheme = /data\s*:\s*(?:text\/html|application\/xhtml\+xml|image\/svg\+xml)(?:[;,]|$)/i;
    var encodedTag = /&(?:lt|#0*60|#x0*3c);/i;
    var eventMatch;
    var knownEventAttribute = false;
    while ((eventMatch = eventAttribute.exec(text)) !== null) {
      if (eventNames.indexOf(eventMatch[1].toLowerCase()) !== -1) {
        knownEventAttribute = true;
        break;
      }
    }
    return tag.test(text) || knownEventAttribute || executableScheme.test(text) ||
      markupDataScheme.test(text) || encodedTag.test(text);
  }

  function text(value, fallback) {
    var normalized = typeof value === 'string' && value.trim() ? value.trim() : (fallback || 'Unavailable');
    return markupLike(normalized) ? (fallback || 'Unavailable') : normalized;
  }

  function location(value, fallback) {
    var unavailable = fallback || 'Service location unavailable';
    if (typeof value === 'string') return text(value, unavailable);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return unavailable;
    var fields = [value.street, value.line1, value.line2, value.city, value.state, value.postalCode, value.zip]
      .filter(function (entry) { return typeof entry === 'string' && entry.trim(); });
    if (!fields.length || fields.some(markupLike)) return unavailable;
    return fields.map(function (entry) { return entry.trim(); }).join(', ');
  }

  global.NorthStarDisplayProjection = Object.freeze({
    markupLike: markupLike,
    text: text,
    location: location,
  });
})(window);

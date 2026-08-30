(function (global) {
  'use strict';

  function markupLike(value) {
    var text = typeof value === 'string' ? value : '';
    var tag = /<\s*\/?\s*[a-z!][^>]*>/i;
    var eventAttribute = /(?:^|[\s"'`<\/(\[{,:;])on([a-z][a-z0-9_-]*)\s*(?:=|&#(?:x0*3d|0*61);)/ig;
    var eventNames = (
      'abort afterprint animationcancel animationend animationiteration animationstart appinstalled auxclick ' +
      'beforecopy beforecut beforeinput beforeinstallprompt beforeload beforematch beforepaste beforeprint ' +
      'beforetoggle beforeunload beforexrselect blur cancel canplay canplaythrough ' +
      'change click close command contentvisibilityautostatechange contextlost contextmenu contextrestored ' +
      'copy cuechange cut dblclick drag ' +
      'dragend dragenter dragleave dragover dragstart drop durationchange emptied encrypted ended ' +
      'enterpictureinpicture error focus focusin focusout formdata freeze fullscreenchange fullscreenerror ' +
      'gamepadconnected gamepaddisconnected gotpointercapture hashchange input invalid keydown keypress keyup ' +
      'languagechange leavepictureinpicture load loadeddata loadedmetadata loadstart lostpointercapture message ' +
      'messageerror mousedown mouseenter mouseleave mousemove mouseout mouseover mouseup mousewheel offline ' +
      'online orientationchange pagehide pagereveal pageshow pageswap paste pause play playing pointercancel ' +
      'pointerdown pointerenter pointerleave pointerlockchange pointerlockerror pointermove pointerout pointerover ' +
      'pointerrawupdate pointerup popstate prerenderingchange progress ratechange readystatechange ' +
      'rejectionhandled reset resize resume scroll scrollend scrollsnapchange scrollsnapchanging search ' +
      'securitypolicyviolation seeked seeking select selectionchange selectstart slotchange stalled storage ' +
      'submit suspend timeupdate toggle touchcancel touchend touchforcechange touchmove touchstart ' +
      'transitioncancel transitionend transitionrun transitionstart unload unhandledrejection visibilitychange ' +
      'volumechange waiting waitingforkey webkitanimationend webkitanimationiteration webkitanimationstart ' +
      'webkitfullscreenchange webkitfullscreenerror webkitmouseforcechanged webkitmouseforcedown ' +
      'webkitmouseforceup webkitmouseforcewillbegin webkittransitionend wheel'
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
    var unavailable = typeof fallback === 'string' ? fallback : 'Unavailable';
    var normalized = typeof value === 'string' && value.trim() ? value.trim() : unavailable;
    return markupLike(normalized) ? unavailable : normalized;
  }

  function location(value, fallback) {
    var unavailable = fallback || 'Service location unavailable';
    if (typeof value === 'string') return text(value, unavailable);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return unavailable;
    var fields = [value.street, value.line1, value.line2, value.city, value.state, value.postalCode, value.zip, value.country]
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

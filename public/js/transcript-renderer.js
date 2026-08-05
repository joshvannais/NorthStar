(function (global) {
  'use strict';

  var DEFAULT_MESSAGES = Object.freeze({
    missing: 'No transcript available.',
    unrecognized: 'Unrecognized transcript format.',
    parseError: 'Unable to parse transcript.',
    empty: 'No transcript turns found.'
  });

  function normalizeSpeaker(speaker) {
    var value = String(speaker == null ? '' : speaker).toLowerCase().trim();
    if (value === 'ai' || value === 'agent' || value === 'assistant' || value === 'bot') return 'ai';
    if (value === 'customer' || value === 'user' || value === 'human') return 'customer';
    return 'system';
  }

  function messageNode(document, message) {
    var node = document.createElement('p');
    node.style.fontSize = '13px';
    node.style.color = 'var(--neutral-500)';
    node.appendChild(document.createTextNode(String(message)));
    return node;
  }

  function normalizeLegacy(text) {
    return String(text).split('\n').map(function (line) {
      var match = line.match(/^([^:]+):(.*)$/);
      if (!match) return { speaker: 'system', text: line };
      var speaker = normalizeSpeaker(match[1]);
      if (speaker === 'system') return { speaker: speaker, text: line };
      return { speaker: speaker, text: match[2].trim() };
    });
  }

  function parseTranscript(transcript) {
    if (transcript === null || transcript === undefined || transcript === '') {
      return { state: 'missing', turns: null, format: 'missing' };
    }
    if (Array.isArray(transcript)) {
      return { state: transcript.length ? 'ready' : 'empty', turns: transcript, format: 'structured' };
    }
    if (typeof transcript !== 'string') {
      return { state: 'unrecognized', turns: null, format: 'unrecognized' };
    }
    try {
      var parsed = JSON.parse(transcript);
      if (!Array.isArray(parsed)) return { state: 'unrecognized', turns: null, format: 'unrecognized' };
      return { state: parsed.length ? 'ready' : 'empty', turns: parsed, format: 'json' };
    } catch (_error) {
      if (transcript.indexOf('\n') >= 0) {
        var legacy = normalizeLegacy(transcript);
        return { state: legacy.length ? 'ready' : 'empty', turns: legacy, format: 'legacy' };
      }
      return { state: 'parseError', turns: null, format: 'parseError' };
    }
  }

  function bubbleNode(document, turn, labels) {
    var speaker = normalizeSpeaker(turn && turn.speaker);
    var bubble = document.createElement('div');
    bubble.className = 'demo-msg ' + speaker;
    var label = labels[speaker];
    if (label) {
      var labelNode = document.createElement('div');
      labelNode.className = 'demo-msg-label';
      labelNode.appendChild(document.createTextNode(String(label)));
      bubble.appendChild(labelNode);
    }
    bubble.appendChild(document.createTextNode(String(turn && turn.text != null ? turn.text : '')));
    return bubble;
  }

  function render(container, transcript, options) {
    if (!container || !container.ownerDocument) throw new TypeError('A mounted transcript container is required.');
    var settings = options || {};
    var document = container.ownerDocument;
    var labels = Object.assign({ ai: '', customer: '', system: '' }, settings.labels || {});
    var messages = Object.assign({}, DEFAULT_MESSAGES, settings.messages || {});
    var preservedScrollTop = container.scrollTop;
    var nodes = [];
    var result;

    if (settings.presentation === 'plain') {
      var plain = document.createElement('span');
      plain.appendChild(document.createTextNode(String(transcript == null ? '' : transcript)));
      nodes.push(plain);
      result = { count: transcript == null || transcript === '' ? 0 : 1, format: 'plain' };
    } else {
      var parsed = parseTranscript(transcript);
      if (parsed.state !== 'ready') {
        nodes.push(messageNode(document, messages[parsed.state]));
        result = { count: 0, format: parsed.format };
      } else {
        parsed.turns.forEach(function (turn) { nodes.push(bubbleNode(document, turn, labels)); });
        result = { count: parsed.turns.length, format: parsed.format };
      }
    }

    container.replaceChildren.apply(container, nodes);
    if (settings.live) {
      container.setAttribute('role', 'log');
      container.setAttribute('aria-live', settings.live);
      container.setAttribute('aria-relevant', 'additions text');
    }
    if (settings.scroll === 'top') container.scrollTop = 0;
    else if (settings.scroll === 'bottom') container.scrollTop = container.scrollHeight;
    else if (settings.scroll === 'preserve') container.scrollTop = preservedScrollTop;
    return result;
  }

  global.NorthStarTranscriptRenderer = Object.freeze({
    normalizeSpeaker: normalizeSpeaker,
    render: render
  });
})(window);

(function (global) {
  'use strict';

  var STATUS_URL = '/api/demo/homepage/status';
  var WEB_CALL_URL = '/api/demo/homepage/web-call';
  var SDK_URL = '/js/vendor/retell-web-client.mjs';
  var CONSENT_PHRASE = 'I consent to this AI demo and temporary recording';
  var DISCLOSURE_COPY = 'This is a NorthStar AI demonstration powered by Retell. If you continue, your microphone audio will be processed and this browser call will be recorded temporarily by NorthStar and Retell solely to produce your demo result. Do not share sensitive or real customer information. You may stop, withdraw consent, or request deletion at any time. Say ' + CONSENT_PHRASE + ' to continue, or hang up to withdraw.';
  var CONSENT_TIMEOUT_MS = 30000;
  var CONNECTION_TIMEOUT_MS = 20000;
  var API_REQUEST_TIMEOUT_MS = 60000;
  var MAX_CALL_MS = 5 * 60 * 1000;
  var MAX_TRANSCRIPT_TURNS = 48;
  var ALLOWED_INDUSTRIES = Object.freeze([
    'Roofing', 'HVAC', 'Plumbing', 'Electrical', 'Painting', 'Tree Service', 'Window Tinting', 'Concrete'
  ]);

  var sdkPromise = null;
  var previousFocus = null;
  var state = freshState();

  function freshState() {
    return {
      available: false,
      availabilityChecked: false,
      client: null,
      callId: null,
      purgeToken: null,
      accessToken: null,
      businessName: '',
      industry: '',
      transcript: [],
      ignoredTranscriptKeys: new Set(),
      consented: false,
      startedAt: null,
      timerInterval: null,
      consentTimeout: null,
      connectionTimeout: null,
      maximumTimeout: null,
      disclosureCancel: null,
      cancelRequested: false,
      finalizing: false,
      deletionState: 'none',
      result: null,
      durationSeconds: 0,
    };
  }

  function byId(id) {
    return global.document.getElementById(id);
  }

  function presentationText(value) {
    var decoded = String(value == null ? '' : value)
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#(?:39|x27);/gi, "'")
      .replace(/&amp;/gi, '&');
    return decoded
      .replace(/<[^>]*>/g, ' ')
      .replace(/\b(?:javascript|data)\s*:/gi, '')
      .replace(/\bon[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]*)/gi, '')
      .replace(/\bfictional\b/gi, '')
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function setText(id, value) {
    var element = byId(id);
    if (element) element.textContent = value == null ? '' : String(value);
  }

  function setNotice(message, status) {
    var notice = byId('demoFormNotice');
    if (!notice) return;
    notice.textContent = message || '';
    if (status) notice.setAttribute('data-state', status);
    else notice.removeAttribute('data-state');
  }

  function setLiveNotice(message, status) {
    var notice = byId('guidedPreviewNotice');
    if (!notice) return;
    notice.textContent = message || '';
    if (status) notice.setAttribute('data-state', status);
    else notice.removeAttribute('data-state');
  }

  function errorMessage(error, fallback) {
    if (error && typeof error.message === 'string' && error.message.trim()) return error.message.trim();
    return fallback;
  }

  function apiError(payload, response) {
    var message = payload && payload.error && typeof payload.error.message === 'string'
      ? payload.error.message : 'The browser Web Call request failed.';
    var error = new Error(message);
    error.status = response.status;
    error.code = payload && payload.error ? payload.error.code : 'homepage_request_failed';
    return error;
  }

  async function requestJson(url, options) {
    var request = Object.assign({
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    }, options || {});
    request.headers = Object.assign({ Accept: 'application/json' }, (options && options.headers) || {});
    var controller = typeof global.AbortController === 'function' ? new global.AbortController() : null;
    var timeout = null;
    if (controller) {
      request.signal = controller.signal;
      timeout = global.setTimeout(function () { controller.abort(); }, API_REQUEST_TIMEOUT_MS);
    }
    var response;
    var payload = null;
    try {
      response = await global.fetch(url, request);
      try { payload = await response.json(); } catch (_parseError) {}
    } catch (error) {
      if (controller && controller.signal.aborted) {
        throw new Error('The Web Call request timed out. No result is available until deletion is verified.');
      }
      throw error;
    } finally {
      if (timeout) global.clearTimeout(timeout);
    }
    if (!response.ok || !payload || payload.success !== true) throw apiError(payload, response);
    return payload.data === undefined ? payload : payload.data;
  }

  function setButtonAvailability() {
    var button = byId('demoCallBtn');
    if (!button) return;
    button.disabled = !state.available || state.finalizing;
    button.textContent = state.available ? 'Start Browser Web Call' : 'Web Call Awaiting Approval';
  }

  async function refreshAvailability() {
    state.availabilityChecked = false;
    state.available = false;
    setButtonAvailability();
    try {
      var payload = await requestJson(STATUS_URL);
      state.available = Boolean(payload && payload.webCall && payload.webCall.available === true);
      state.availabilityChecked = true;
      if (state.available) {
        setNotice('Ready. Check the consent box to review the audible disclosure.', 'success');
      } else {
        setNotice('The browser Web Call is not active. Final attorney and Retell privacy approval is still required.', 'error');
      }
    } catch (_error) {
      state.availabilityChecked = true;
      state.available = false;
      setNotice('The browser Web Call availability check failed closed. Please try again later.', 'error');
    }
    setButtonAvailability();
  }

  function showView(view) {
    var pre = byId('demoPreCallView');
    var live = byId('demoLiveView');
    var post = byId('demoPostCallView');
    if (pre) pre.style.display = view === 'pre' ? 'block' : 'none';
    if (live) live.style.display = view === 'live' ? 'block' : 'none';
    if (post) post.style.display = view === 'post' ? 'block' : 'none';
  }

  function clearTimers() {
    if (state.timerInterval) global.clearInterval(state.timerInterval);
    if (state.consentTimeout) global.clearTimeout(state.consentTimeout);
    if (state.connectionTimeout) global.clearTimeout(state.connectionTimeout);
    if (state.maximumTimeout) global.clearTimeout(state.maximumTimeout);
    state.timerInterval = null;
    state.consentTimeout = null;
    state.connectionTimeout = null;
    state.maximumTimeout = null;
  }

  function validateForm() {
    var businessName = byId('demoBusinessName');
    var industry = byId('demoIndustry');
    var consent = byId('demoConsentCheckbox');
    var rawName = businessName && typeof businessName.value === 'string' ? businessName.value.trim() : '';
    var name = presentationText(rawName).slice(0, 80);
    if (!name || rawName.length > 80) {
      setNotice('Enter a business name of 80 characters or fewer. It stays only in this browser memory.', 'error');
      if (businessName) businessName.focus();
      return null;
    }
    if (businessName) businessName.value = name;
    if (!industry || ALLOWED_INDUSTRIES.indexOf(industry.value) < 0) {
      setNotice('Choose a supported home-service industry.', 'error');
      if (industry) industry.focus();
      return null;
    }
    if (!consent || consent.checked !== true) {
      setNotice('Check the consent box before microphone access or temporary processing can begin.', 'error');
      if (consent) consent.focus();
      return null;
    }
    if (!state.available) {
      setNotice('The browser Web Call remains unavailable until its approval and privacy gates are satisfied.', 'error');
      return null;
    }
    return { businessName: name, industry: industry.value };
  }

  function focusableInDialog() {
    var dialog = byId('preCallModal');
    if (!dialog) return [];
    return Array.prototype.filter.call(dialog.querySelectorAll('button, [href], input, select, [tabindex]'), function (element) {
      return !element.disabled && !element.hidden && element.getAttribute('tabindex') !== '-1';
    });
  }

  function closeDialog(returnFocus) {
    var dialog = byId('preCallModal');
    if (!dialog) return;
    dialog.classList.remove('active');
    dialog.setAttribute('aria-hidden', 'true');
    global.document.removeEventListener('keydown', handleDialogKeydown);
    if (returnFocus && previousFocus && typeof previousFocus.focus === 'function') previousFocus.focus();
  }

  function handleDialogKeydown(event) {
    var dialog = byId('preCallModal');
    if (!dialog || dialog.getAttribute('aria-hidden') !== 'false') return;
    if (event.key === 'Escape') {
      event.preventDefault();
      closeDialog(true);
      return;
    }
    if (event.key !== 'Tab') return;
    var focusable = focusableInDialog();
    if (!focusable.length) return;
    var first = focusable[0];
    var last = focusable[focusable.length - 1];
    if (event.shiftKey && global.document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && global.document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function showPreCallModal() {
    var values = validateForm();
    if (!values) return false;
    state.businessName = values.businessName;
    state.industry = values.industry;
    setText('selectedScenarioContext', values.industry + ' demo selected. “' + values.businessName + '” remains only in browser memory and is never sent to Retell or NorthStar.');
    var dialog = byId('preCallModal');
    if (!dialog) return false;
    previousFocus = global.document.activeElement || byId('demoCallBtn');
    dialog.classList.add('active');
    dialog.setAttribute('aria-hidden', 'false');
    global.document.addEventListener('keydown', handleDialogKeydown);
    var primary = byId('modalCallBtn');
    if (primary) primary.focus();
    return true;
  }

  function speakDisclosure() {
    return new Promise(function (resolve, reject) {
      if (!global.speechSynthesis || typeof global.SpeechSynthesisUtterance !== 'function') {
        reject(new Error('This browser cannot play the required audible disclosure, so the call was not started.'));
        return;
      }
      var settled = false;
      var timeout = global.setTimeout(function () {
        if (settled) return;
        settled = true;
        state.disclosureCancel = null;
        try { global.speechSynthesis.cancel(); } catch (_error) {}
        reject(new Error('The required audible disclosure did not finish, so the call was not started.'));
      }, 25000);
      var utterance = new global.SpeechSynthesisUtterance(DISCLOSURE_COPY);
      utterance.rate = 0.96;
      state.disclosureCancel = function () {
        if (settled) return;
        settled = true;
        global.clearTimeout(timeout);
        try { global.speechSynthesis.cancel(); } catch (_error) {}
        reject(new Error('The Web Call start was cancelled before microphone access.'));
      };
      utterance.onend = function () {
        if (settled) return;
        settled = true;
        global.clearTimeout(timeout);
        state.disclosureCancel = null;
        resolve();
      };
      utterance.onerror = function () {
        if (settled) return;
        settled = true;
        global.clearTimeout(timeout);
        state.disclosureCancel = null;
        reject(new Error('The required audible disclosure could not be played, so the call was not started.'));
      };
      try {
        global.speechSynthesis.cancel();
        global.speechSynthesis.speak(utterance);
      } catch (_error) {
        global.clearTimeout(timeout);
        state.disclosureCancel = null;
        reject(new Error('The required audible disclosure could not be played, so the call was not started.'));
      }
    });
  }

  function loadSdk() {
    if (!sdkPromise) {
      sdkPromise = import(SDK_URL).then(function (module) {
        if (!module || typeof module.RetellWebClient !== 'function') throw new Error('The Web Call client is unavailable.');
        return module.RetellWebClient;
      });
    }
    return sdkPromise;
  }

  function showCallPhase(phase) {
    ['Dialing', 'Ringing', 'Answered'].forEach(function (name) {
      var element = byId('callState' + name);
      if (element) element.style.display = name.toLowerCase() === phase ? 'block' : 'none';
    });
  }

  function formatDuration(seconds) {
    var safe = Math.max(0, Number(seconds) || 0);
    var minutes = Math.floor(safe / 60);
    var remainder = Math.floor(safe % 60);
    return String(minutes).padStart(2, '0') + ':' + String(remainder).padStart(2, '0');
  }

  function updateTimer() {
    var seconds = state.startedAt ? Math.floor((Date.now() - state.startedAt) / 1000) : 0;
    state.durationSeconds = seconds;
    setText('demoLiveTimer', formatDuration(seconds));
  }

  function startConnectedTimer() {
    if (state.startedAt || state.finalizing || !state.callId) return;
    state.startedAt = Date.now();
    state.durationSeconds = 0;
    updateTimer();
    state.timerInterval = global.setInterval(updateTimer, 1000);
    state.maximumTimeout = global.setTimeout(function () {
      setLiveNotice('The five-minute demo limit was reached. Ending and deleting the call.', 'error');
      finalizeCall(false);
    }, MAX_CALL_MS);
  }

  function setLiveControls(mode) {
    var hangup = byId('demoHangupBtn');
    var withdraw = byId('demoWithdrawBtn');
    var retry = byId('demoRetryDeleteBtn');
    if (hangup) hangup.hidden = mode !== 'active';
    if (withdraw) withdraw.hidden = mode !== 'active';
    if (retry) retry.hidden = mode !== 'retry';
  }

  function transcriptKey(turn) {
    return turn.speaker + '\u0000' + turn.text.toLocaleLowerCase();
  }

  function normalizedTurns(event) {
    var source = event && Array.isArray(event.transcript) ? event.transcript
      : (event && Array.isArray(event.transcripts) ? event.transcripts : []);
    return source.map(function (turn) {
      var role = turn && (turn.role || turn.speaker);
      var speaker = role === 'agent' || role === 'assistant' || role === 'ai' ? 'agent'
        : (role === 'user' || role === 'customer' ? 'customer' : null);
      var content = turn && (turn.content === undefined ? turn.text : turn.content);
      var text = typeof content === 'string' ? presentationText(content) : '';
      if (!speaker || !text) return null;
      return { speaker: speaker, text: text.slice(0, 600) };
    }).filter(Boolean).slice(-12);
  }

  function isConsent(text) {
    var value = String(text || '').toLocaleLowerCase().replace(/[^a-z\s']/g, ' ').replace(/\s+/g, ' ').trim();
    return value === CONSENT_PHRASE.toLocaleLowerCase() || value === ('yes ' + CONSENT_PHRASE.toLocaleLowerCase());
  }

  function isWithdrawal(text) {
    var value = String(text || '').toLocaleLowerCase();
    return /\b(i (?:do not|don't) consent|i withdraw|stop the call|delete the call|no consent)\b/.test(value);
  }

  function absorbTurns(turns) {
    turns.forEach(function (turn) {
      var key = transcriptKey(turn);
      if (state.ignoredTranscriptKeys.has(key)) return;
      var recent = state.transcript.slice(-12);
      if (recent.some(function (existing) { return transcriptKey(existing) === key; })) return;
      var last = state.transcript[state.transcript.length - 1];
      if (last && last.speaker === turn.speaker &&
          (turn.text.indexOf(last.text) === 0 || last.text.indexOf(turn.text) === 0)) {
        if (turn.text.length > last.text.length) last.text = turn.text;
        return;
      }
      state.transcript.push(turn);
    });
    if (state.transcript.length > MAX_TRANSCRIPT_TURNS) {
      state.transcript = state.transcript.slice(-MAX_TRANSCRIPT_TURNS);
    }
  }

  function renderTranscript() {
    var body = byId('demoTranscriptBody');
    if (!body) return;
    body.replaceChildren();
    var system = global.document.createElement('div');
    system.className = 'demo-msg system';
    system.textContent = state.consented
      ? 'Temporary browser memory only. Transcript is purged before any result is shown.'
      : 'Waiting for the exact verbal consent phrase. Pre-consent transcript content is not displayed or retained by NorthStar.';
    body.appendChild(system);
    state.transcript.forEach(function (turn) {
      var message = global.document.createElement('div');
      message.className = 'demo-msg ' + (turn.speaker === 'agent' ? 'ai' : 'customer');
      var label = global.document.createElement('div');
      label.className = 'demo-msg-label';
      label.textContent = turn.speaker === 'agent' ? 'NorthStar' : 'You';
      var content = global.document.createElement('div');
      content.textContent = turn.text;
      message.appendChild(label);
      message.appendChild(content);
      body.appendChild(message);
    });
    setText('demoTranscriptCount', state.transcript.length + (state.transcript.length === 1 ? ' message' : ' messages'));
    body.scrollTop = body.scrollHeight;
  }

  function handleTranscriptUpdate(event) {
    if (state.finalizing || !state.callId) return;
    var turns = normalizedTurns(event);
    if (!turns.length) return;
    var withdrawn = turns.some(function (turn) { return turn.speaker === 'customer' && isWithdrawal(turn.text); });
    if (withdrawn) {
      setLiveNotice('Withdrawal heard. Ending the call and verifying deletion now.', 'error');
      finalizeCall(false);
      return;
    }
    if (!state.consented) {
      var consentIndex = -1;
      turns.forEach(function (turn, index) {
        if (turn.speaker === 'customer' && isConsent(turn.text)) consentIndex = index;
      });
      if (consentIndex < 0) return;
      turns.slice(0, consentIndex + 1).forEach(function (turn) {
        state.ignoredTranscriptKeys.add(transcriptKey(turn));
      });
      state.consented = true;
      if (state.consentTimeout) global.clearTimeout(state.consentTimeout);
      state.consentTimeout = null;
      showCallPhase('answered');
      setText('demoStatusLabel', 'Consented conversation in progress');
      setText('demoIntent', state.industry + ' service request');
      setText('demoQualification', 'Collecting supported job facts');
      setText('demoSummary', 'Polaris will process the consented conversation in memory after you hang up.');
      setLiveNotice('Verbal consent confirmed. Continue with demo job details only.', 'success');
      absorbTurns(turns.slice(consentIndex + 1));
      renderTranscript();
      return;
    }
    absorbTurns(turns);
    renderTranscript();
  }

  function attachClientEvents(client) {
    client.on('call_started', function () {
      if (state.client !== client || !state.callId || state.finalizing) return;
      if (state.connectionTimeout) global.clearTimeout(state.connectionTimeout);
      state.connectionTimeout = null;
      startConnectedTimer();
      showCallPhase('ringing');
      setText('demoStatusLabel', 'Connected — say the displayed consent phrase');
      setLiveNotice('Say “' + CONSENT_PHRASE + '” within 30 seconds. You can hang up or withdraw at any time.', 'success');
      state.consentTimeout = global.setTimeout(function () {
        if (!state.consented) {
          setLiveNotice('Verbal consent was not confirmed. Ending and deleting the call.', 'error');
          finalizeCall(false);
        }
      }, CONSENT_TIMEOUT_MS);
    });
    client.on('call_ready', function () {
      if (state.client !== client || !state.callId || state.finalizing) return;
      startConnectedTimer();
      setText('demoStatusLabel', state.consented ? 'Consented conversation in progress' : 'Connected — say the displayed consent phrase');
    });
    client.on('update', function (event) {
      if (state.client !== client) return;
      handleTranscriptUpdate(event);
    });
    client.on('agent_start_talking', function () {
      if (state.client !== client || !state.callId || state.finalizing) return;
      if (state.consented) setText('demoStatusLabel', 'NorthStar is speaking');
    });
    client.on('agent_stop_talking', function () {
      if (state.client !== client || !state.callId || state.finalizing) return;
      if (state.consented) setText('demoStatusLabel', 'Listening for job details');
    });
    client.on('call_ended', function () {
      if (state.client === client && !state.finalizing && state.callId) finalizeCall(state.consented);
    });
    client.on('error', function () {
      if (state.client === client && !state.finalizing && state.callId) {
        setLiveNotice('The Web Call client reported an error. Deletion is being verified.', 'error');
        finalizeCall(false);
      }
    });
  }

  function startLivePresentation() {
    showView('live');
    showCallPhase('dialing');
    setLiveControls('active');
    setText('demoStatusLabel', 'Checking privacy gates before microphone access');
    setText('demoLiveTimer', '00:00');
    setText('demoIntent', 'Consent pending');
    setText('demoQualification', 'Not started');
    setText('demoSummary', 'The conversation is not retained until the exact verbal consent phrase is confirmed.');
    var actions = byId('demoActions');
    if (actions) {
      actions.replaceChildren();
      var item = global.document.createElement('li');
      item.textContent = 'Say “' + CONSENT_PHRASE + ',” then describe a demo job.';
      actions.appendChild(item);
    }
    state.transcript = [];
    renderTranscript();
    global.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function executeDemoCall() {
    if (state.finalizing || state.callId) return false;
    var values = validateForm();
    if (!values) {
      closeDialog(true);
      return false;
    }
    state.businessName = values.businessName;
    state.industry = values.industry;
    state.cancelRequested = false;
    closeDialog(false);
    state.finalizing = true;
    setButtonAvailability();
    startLivePresentation();
    try {
      setText('demoStatusLabel', 'Playing required disclosure before microphone access');
      await speakDisclosure();
      state.disclosureCancel = null;
      if (state.cancelRequested) throw new Error('The Web Call start was cancelled before microphone access.');
      setText('demoStatusLabel', 'Creating temporary Basic-Attributes-Only Web Call');
      var Client = await loadSdk();
      if (state.cancelRequested) throw new Error('The Web Call start was cancelled before microphone access.');
      var created = await requestJson(WEB_CALL_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-NorthStar-Demo-Intent': 'start-homepage-web-call',
        },
        body: JSON.stringify({ consentAcknowledged: true, industry: state.industry }),
      });
      state.callId = created.callId;
      state.purgeToken = created.purgeToken;
      state.accessToken = created.accessToken;
      if (created.verbalConsentPhrase !== CONSENT_PHRASE || created.disclosureText !== DISCLOSURE_COPY ||
          created.transport !== 'retell_browser_web_call_no_phone_number' ||
          created.storage !== 'basic_attributes_only' || created.retentionDays !== 1) {
        throw new Error('The temporary Web Call did not return the required consent and privacy contract.');
      }
      state.deletionState = 'pending';
      if (state.cancelRequested) {
        state.finalizing = false;
        await finalizeCall(false);
        return false;
      }
      state.startedAt = null;
      state.durationSeconds = 0;
      var client = new Client();
      state.client = client;
      attachClientEvents(client);
      state.finalizing = false;
      state.connectionTimeout = global.setTimeout(function () {
        setLiveNotice('The Web Call did not connect in time. Deletion is being verified.', 'error');
        finalizeCall(false);
      }, CONNECTION_TIMEOUT_MS);
      // Begin the visible elapsed timer as soon as the visitor-authorized Web
      // Call enters the SDK connection attempt. Retell may not emit the same
      // readiness event in every supported browser, so the UI must not remain
      // stuck at 00:00 while microphone transport is active.
      startConnectedTimer();
      await client.startCall({ accessToken: state.accessToken });
      // The pinned SDK cannot abort Room.connect before its internal connected
      // bit is set. If withdrawal/deletion won that race, stop the exact local
      // client again after startCall settles so a late connection cannot leave
      // microphone transport alive or mutate a later demo state.
      if (state.client !== client || state.callId !== created.callId || state.finalizing) {
        try { client.stopCall(); } catch (_error) {}
        return false;
      }
      return true;
    } catch (error) {
      state.finalizing = false;
      if (state.callId && state.purgeToken) {
        setLiveNotice(errorMessage(error, 'The Web Call could not start.') + ' Deletion is being verified.', 'error');
        await finalizeCall(false);
      } else {
        clearTimers();
        state.disclosureCancel = null;
        state.cancelRequested = false;
        clearCallSecrets();
        showView('pre');
        setNotice(errorMessage(error, 'The Web Call could not start.'), 'error');
        setButtonAvailability();
      }
      return false;
    }
  }

  async function requestPolaris(verifiedPurgeReceipt) {
    if (!state.callId || !state.purgeToken || !state.consented || !state.transcript.length ||
        typeof verifiedPurgeReceipt !== 'string' || !verifiedPurgeReceipt) return null;
    return requestJson('/api/demo/homepage/polaris/' + encodeURIComponent(state.callId), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-NorthStar-Demo-Intent': 'calculate-homepage-polaris',
      },
      body: JSON.stringify({
        callDurationSeconds: state.durationSeconds,
        industry: state.industry,
        purgeToken: state.purgeToken,
        transcript: state.transcript,
        verifiedPurgeReceipt: verifiedPurgeReceipt,
      }),
    });
  }

  async function requestPurge(projectionRequested) {
    if (!state.callId || !state.purgeToken || typeof projectionRequested !== 'boolean') {
      throw new Error('The temporary deletion authority is unavailable.');
    }
    return requestJson('/api/demo/homepage/web-call/' + encodeURIComponent(state.callId), {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        'X-NorthStar-Demo-Intent': 'delete-homepage-web-call',
      },
      body: JSON.stringify({ projectionRequested: projectionRequested, purgeToken: state.purgeToken }),
    });
  }

  function stopBrowserClient() {
    var client = state.client;
    state.client = null;
    if (client && typeof client.stopCall === 'function') {
      try { client.stopCall(); } catch (_error) {}
    }
  }

  function requestCallEnd(buildPolaris) {
    if (!state.callId && state.finalizing) {
      state.cancelRequested = true;
      setLiveControls('none');
      setText('demoStatusLabel', 'Cancelling before microphone access');
      setLiveNotice('The Web Call start is being cancelled. No result will be created.', 'error');
      if (typeof state.disclosureCancel === 'function') state.disclosureCancel();
      return true;
    }
    return finalizeCall(buildPolaris);
  }

  function clearCallSecrets() {
    state.callId = null;
    state.purgeToken = null;
    state.accessToken = null;
    state.transcript = [];
    state.ignoredTranscriptKeys = new Set();
    state.consented = false;
    state.startedAt = null;
    state.disclosureCancel = null;
    state.cancelRequested = false;
    state.deletionState = 'verified';
    renderTranscript();
  }

  function failClosedDeletion(error) {
    state.deletionState = 'unverified';
    state.accessToken = null;
    state.transcript = [];
    state.result = null;
    state.consented = false;
    renderTranscript();
    setLiveControls('retry');
    showCallPhase('dialing');
    setText('demoStatusLabel', 'Deletion not verified — results withheld');
    setLiveNotice(errorMessage(error, 'Deletion could not be verified.') + ' No result is available. Retry verified deletion.', 'error');
    state.finalizing = false;
  }

  async function finalizeCall(buildPolaris) {
    if (state.finalizing || !state.callId) return false;
    state.finalizing = true;
    clearTimers();
    updateTimer();
    stopBrowserClient();
    setLiveControls('none');
    setText('demoStatusLabel', 'Ending call and verifying provider deletion');
    setLiveNotice('Results remain hidden until Retell deletion and NorthStar purge are both verified.', 'success');
    var shouldProject = Boolean(buildPolaris && state.consented && state.transcript.length);
    var result = null;
    var projectionError = null;
    var purge;
    try {
      purge = await requestPurge(shouldProject);
      if (!purge || purge.providerDeletionVerified !== true || purge.northstarPurged !== true) {
        throw new Error('Deletion did not return the required verification receipt.');
      }
    } catch (error) {
      failClosedDeletion(error);
      return false;
    }
    if (shouldProject) {
      if (typeof purge.verifiedPurgeReceipt !== 'string' || !purge.verifiedPurgeReceipt) {
        projectionError = new Error('Verified deletion completed without a usable Polaris receipt.');
      } else {
        try {
          result = await requestPolaris(purge.verifiedPurgeReceipt);
        } catch (error) {
          projectionError = error;
        }
      }
    }
    var duration = state.durationSeconds;
    clearCallSecrets();
    state.finalizing = false;
    setButtonAvailability();
    if (projectionError || !result) {
      showView('pre');
      setNotice(projectionError
        ? 'The call was deleted and purged, but Polaris could not build a result: ' + errorMessage(projectionError, 'processing failed')
        : 'The call was deleted and purged. No result was created because consented job details were not captured.', 'error');
      return true;
    }
    state.result = result;
    state.durationSeconds = duration;
    renderPolaris(result);
    showView('post');
    global.scrollTo({ top: 0, behavior: 'smooth' });
    return true;
  }

  async function retryDeletion() {
    if (state.finalizing || state.deletionState !== 'unverified') return false;
    state.finalizing = true;
    setLiveControls('none');
    setText('demoStatusLabel', 'Retrying verified deletion');
    try {
      var purge = await requestPurge(false);
      if (!purge || purge.providerDeletionVerified !== true || purge.northstarPurged !== true) {
        throw new Error('Deletion did not return the required verification receipt.');
      }
      clearCallSecrets();
      state.finalizing = false;
      showView('pre');
      setNotice('Verified deletion completed. No transcript or result was retained.', 'success');
      setButtonAvailability();
      return true;
    } catch (error) {
      failClosedDeletion(error);
      return false;
    }
  }

  function formatCurrency(value) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return 'Unavailable — supported pricing inputs are missing';
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value);
  }

  function setList(id, values, fallback) {
    var list = byId(id);
    if (!list) return;
    list.replaceChildren();
    var items = values && values.length ? values : [fallback];
    items.forEach(function (value) {
      var item = global.document.createElement('li');
      item.textContent = value;
      list.appendChild(item);
    });
  }

  function renderFactRows(facts) {
    var body = byId('reportVarsBody');
    if (!body) return;
    body.replaceChildren();
    if (!facts || !facts.length) {
      var missing = global.document.createElement('p');
      missing.textContent = 'No supported estimating variable was captured, so pricing was not calculated.';
      body.appendChild(missing);
      return;
    }
    facts.forEach(function (fact) {
      var row = global.document.createElement('div');
      row.className = 'polaris-customer-row';
      var label = global.document.createElement('span');
      label.className = 'polaris-customer-label';
      label.textContent = fact.variable;
      var value = global.document.createElement('span');
      value.className = 'polaris-customer-value';
      value.textContent = fact.displayValue;
      row.appendChild(label);
      row.appendChild(value);
      body.appendChild(row);
    });
  }

  function renderPolaris(result) {
    var pricing = result.pricing || {};
    var confidence = result.confidence || {};
    var qualification = result.qualification || {};
    var actions = Array.isArray(result.recommendedActions) ? result.recommendedActions.map(function (action) {
      return action && (action.label || action.action) ? String(action.label || action.action) : null;
    }).filter(Boolean) : [];
    var price = formatCurrency(pricing.customerFacingPrice);
    var score = Number.isFinite(Number(confidence.score)) ? Math.max(0, Math.min(100, Number(confidence.score))) : 0;
    var primaryAction = actions[0] || 'Collect the missing supported scope and review with an authorized person.';
    setText('demoCallDuration', 'Call length: ' + formatDuration(state.durationSeconds));
    setText('reportRevenue', price);
    setText('reportConfidence', Math.round(score) + '%');
    var fill = byId('reportConfFill');
    if (fill) fill.style.width = Math.round(score) + '%';
    var rec = byId('reportRec');
    if (rec) {
      var recText = rec.querySelector('.polaris-report-rec-text');
      if (recText) recText.textContent = primaryAction;
    }
    setText('reportExecBody', 'Polaris processed ' + (qualification.captured || 0) + ' of ' +
      (qualification.expected || 0) + ' supported estimating facts for this consented ' + state.industry +
      ' conversation. ' + (pricing.status === 'calculated'
        ? 'The displayed range comes from the versioned demo Business Profile and is not a quote.'
        : 'Pricing remains not calculated because required supported scope was not captured.'));
    renderFactRows(result.facts || []);
    setText('reportIntent', state.industry + ' request');
    setText('reportQual', (qualification.captured || 0) + ' / ' + (qualification.expected || 0) + ' supported facts');
    setText('reportBooking', 'Not predicted');
    setList('reportActionsList', actions, 'Collect supported scope for authorized follow-up.');
    var reasoning = byId('reportReasoningBody');
    if (reasoning) {
      reasoning.replaceChildren();
      var explanation = global.document.createElement('p');
      explanation.textContent = 'This result uses only the supported demo facts shown above and the demo Business Profile. ' +
        'Customer contact fields and the call transcript are not included in this result.';
      reasoning.appendChild(explanation);
    }
    var report = byId('polarisReportContainer');
    if (report) report.style.display = 'block';
    var customer = byId('reportCustomerSection');
    if (customer) customer.style.display = 'none';
    var adjustments = byId('reportAdjSection');
    if (adjustments) adjustments.style.display = 'none';
    var actionsSection = byId('postActionsSection');
    if (actionsSection) {
      actionsSection.replaceChildren();
      var notice = global.document.createElement('p');
      notice.className = 'homepage-result-notice';
      notice.textContent = (result.profile && result.profile.pricingNotice) || 'Illustrative demo output; not a quote.';
      actionsSection.appendChild(notice);
    }
  }

  function toggleReportReasoning() {
    var body = byId('reportReasoningBody');
    if (body) body.classList.toggle('open');
  }

  function togglePolarisReasoning() {
    var body = byId('polarisReasoningBody');
    if (body) body.classList.toggle('open');
  }

  function resetDemo() {
    if (state.callId) {
      setLiveNotice('Delete the active call before starting another.', 'error');
      showView('live');
      return false;
    }
    clearTimers();
    state.result = null;
    state.cancelRequested = false;
    state.businessName = '';
    state.industry = '';
    state.durationSeconds = 0;
    var business = byId('demoBusinessName');
    var industry = byId('demoIndustry');
    var consent = byId('demoConsentCheckbox');
    if (business) business.value = '';
    if (industry) industry.value = '';
    if (consent) consent.checked = false;
    setText('reportRevenue', 'Analyzing...');
    var report = byId('polarisReportContainer');
    if (report) report.style.display = 'none';
    showView('pre');
    setNotice(state.available
      ? 'Ready. Check the consent box to review the audible disclosure.'
      : 'The browser Web Call remains unavailable until its approval and privacy gates are satisfied.', state.available ? 'success' : 'error');
    setButtonAvailability();
    global.scrollTo({ top: 0, behavior: 'smooth' });
    return true;
  }

  function deleteBrowserResults() {
    state.result = null;
    resetDemo();
    setNotice('Browser-memory results deleted.', 'success');
  }

  function launchNewScenario() {
    return resetDemo();
  }

  function pageHidePurge() {
    if (!state.callId || !state.purgeToken) return;
    stopBrowserClient();
    try {
      global.fetch('/api/demo/homepage/web-call/' + encodeURIComponent(state.callId), {
        method: 'DELETE',
        credentials: 'same-origin',
        keepalive: true,
        headers: {
          'Content-Type': 'application/json',
          'X-NorthStar-Demo-Intent': 'delete-homepage-web-call',
        },
        body: JSON.stringify({ projectionRequested: false, purgeToken: state.purgeToken }),
      });
    } catch (_error) {}
    state.transcript = [];
    state.result = null;
    state.accessToken = null;
  }

  function bind() {
    var cancel = byId('modalCancelBtn');
    var overlay = byId('preCallModal');
    var hangup = byId('demoHangupBtn');
    var withdraw = byId('demoWithdrawBtn');
    var retry = byId('demoRetryDeleteBtn');
    var deleteResults = byId('demoDeleteResultsBtn');
    var another = byId('guidedTryAnother');
    if (cancel) cancel.addEventListener('click', function () { closeDialog(true); });
    if (overlay) overlay.addEventListener('click', function (event) {
      if (event.target === overlay) closeDialog(true);
    });
    if (hangup) hangup.addEventListener('click', function () { requestCallEnd(true); });
    if (withdraw) withdraw.addEventListener('click', function () { requestCallEnd(false); });
    if (retry) retry.addEventListener('click', retryDeletion);
    if (deleteResults) deleteResults.addEventListener('click', deleteBrowserResults);
    if (another) another.addEventListener('click', resetDemo);
    global.addEventListener('pagehide', pageHidePurge);
  }

  function diagnostics() {
    return Object.freeze({
      available: state.available,
      availabilityChecked: state.availabilityChecked,
      active: Boolean(state.callId),
      consented: state.consented,
      transcriptTurns: state.transcript.length,
      deletionState: state.deletionState,
      resultVisible: Boolean(state.result),
      persistence: 'browser-memory-only',
    });
  }

  global.showPreCallModal = showPreCallModal;
  global.executeDemoCall = executeDemoCall;
  global.resetDemo = resetDemo;
  global.launchNewScenario = launchNewScenario;
  global.toggleReportReasoning = toggleReportReasoning;
  global.togglePolarisReasoning = togglePolarisReasoning;
  global.NorthStarHomepageDemo = Object.freeze({
    getState: diagnostics,
    refreshAvailability: refreshAvailability,
  });

  function initialize() {
    bind();
    showView('pre');
    setButtonAvailability();
    refreshAvailability();
  }

  if (global.document.readyState === 'loading') {
    global.document.addEventListener('DOMContentLoaded', initialize, { once: true });
  } else {
    initialize();
  }
})(window);

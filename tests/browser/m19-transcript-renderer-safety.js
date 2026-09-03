'use strict';

const assert = require('assert');
const { navigationFixture } = require('../helpers/navigation-fixture');
const { resolveBrowserRuntime } = require('../helpers/playwright-runtime');

[
  'DATABASE_URL', 'RETELL_API_KEY', 'RETELL_AGENT_ID', 'RETELL_PHONE_NUMBER',
  'RETELL_WEBHOOK_SECRET', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET',
  'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_PHONE_NUMBER',
  'RESEND_API_KEY', 'SMTP_HOST', 'SMTP_USER', 'SMTP_PASS',
].forEach(name => { delete process.env[name]; });

const { app } = require('../../src/server');

const VIEWPORTS = Object.freeze([
  Object.freeze({ label: 'desktop', width: 1440, height: 900 }),
  Object.freeze({ label: 'mobile', width: 390, height: 844 }),
]);
const THEMES = Object.freeze(['light', 'dark']);
const ACCOUNT_USER_ID = '00000000-0000-4000-8000-000000000501';
const ORGANIZATION_ID = '00000000-0000-4000-8000-000000000502';
const CUSTOMER_ID = '00000000-0000-4000-8000-000000000503';
const OPPORTUNITY_ID = '00000000-0000-4000-8000-000000000504';
const TRANSCRIPT_ID = '00000000-0000-4000-8000-000000000505';
const COMMUNICATION_ID = '00000000-0000-4000-8000-000000000506';
const LEGACY_COMMUNICATION_ID = '00000000-0000-4000-8000-000000000507';
const FACT_ID = '00000000-0000-4000-8000-000000000508';
const SESSION_ID = 'sim_m19_transcript_browser';
const TIMESTAMP = '2026-08-05T12:00:00.000Z';
const IMAGE_PAYLOAD = '<img src="/m19-transcript-attack-image" onerror="window.__m19TranscriptXss=1">';
const LEGACY_IMAGE_PAYLOAD = '<img src="/m19-transcript-attack-legacy" onerror="window.__m19TranscriptLegacyXss=1">';
const LEAD_IMAGE_PAYLOAD = '<img src="/m19-transcript-attack-lead" onerror="window.__m19TranscriptLeadXss=1">';
const CLOSING_PAYLOAD = '</div><script>window.__m19TranscriptScript=1</script><svg onload="window.__m19TranscriptSvg=1">';
const LABEL_PAYLOAD = '<img/src=/m19-transcript-attack-label/onerror=window.__m19TranscriptLabelXss=1>';
const STALE_TRANSCRIPT_SENTINEL = 'M19_STALE_TRANSCRIPT_SENTINEL';
const CUSTOMER_NAME = 'Cedar Customer';
const DRAWER_CUSTOMER_NAME = LABEL_PAYLOAD + ' Cedar';
const STRUCTURED_TURNS = Object.freeze([
  Object.freeze({ speaker: 'assistant', text: 'Structured ' + IMAGE_PAYLOAD }),
  Object.freeze({ speaker: 'human', text: CLOSING_PAYLOAD }),
  Object.freeze({ speaker: 'observer', text: 'Unknown speaker remains system text' }),
]);
const PUBLIC_TURNS = Object.freeze([
  Object.freeze({ speaker: 'agent', text: 'Public ' + IMAGE_PAYLOAD }),
  Object.freeze({ speaker: 'customer', text: CLOSING_PAYLOAD }),
  Object.freeze({ speaker: 'observer', text: 'Public system status' }),
]);
const LEGACY_TRANSCRIPT = 'Agent: Legacy ' + LEGACY_IMAGE_PAYLOAD + '\nCustomer: ' + CLOSING_PAYLOAD + '\nObserver: unchanged';
const LEAD_TRANSCRIPT = 'Agent: Mounted ' + LEAD_IMAGE_PAYLOAD + '\nCustomer: ' + CLOSING_PAYLOAD;
const CUSTOMER_SURFACES = Object.freeze([
  Object.freeze({ label: 'Leads CustomerDetail', route: '/dashboard/leads' }),
  Object.freeze({ label: 'Communications CustomerDetail', route: '/dashboard/communications' }),
]);

function json(body, status = 200) {
  return {
    status,
    contentType: 'application/json; charset=utf-8',
    headers: { 'Cache-Control': 'no-store' },
    body: JSON.stringify(body),
  };
}

function account() {
  return {
    user: { id: ACCOUNT_USER_ID, status: 'active', email: 'owner@example.test', phone: '+15555550199' },
    organization: { id: ORGANIZATION_ID, name: 'NorthStar Transcript Safety' },
    navigation: navigationFixture(),
    memberships: [{ role: 'owner', status: 'active' }],
    onboarding: { status: 'complete' },
    subscription: { safe: true, state: 'active', readOnly: false, showTrialBanner: false },
  };
}

function canonicalItem() {
  const digest = '5'.repeat(64);
  return {
    readModelVersion: 'm19-part3-read-v1',
    legacy: false,
    ids: {
      operation: '00000000-0000-4000-8000-000000000510',
      graph: '00000000-0000-4000-8000-000000000511',
      customer: CUSTOMER_ID,
      transcript: TRANSCRIPT_ID,
      communication: COMMUNICATION_ID,
      opportunity: OPPORTUNITY_ID,
      estimate: '00000000-0000-4000-8000-000000000512',
      appointment: '00000000-0000-4000-8000-000000000513',
      polarisSnapshot: '00000000-0000-4000-8000-000000000514',
      facts: [FACT_ID],
    },
    source: {
      type: 'simulation', version: 'm19-transcript-browser-v1',
      externalCustomerId: 'browser-customer', externalCallId: 'browser-call',
      externalTranscriptId: 'browser-transcript', externalCommunicationId: 'browser-communication',
      externalAppointmentId: 'browser-appointment',
    },
    customer: {
      id: CUSTOMER_ID, name: CUSTOMER_NAME, email: 'customer@example.test',
      phone: '+15555550100', address: { line1: '100 Cedar Lane' },
    },
    transcript: { id: TRANSCRIPT_ID, text: JSON.stringify(STRUCTURED_TURNS), occurredAt: TIMESTAMP, durationSeconds: 42 },
    communication: { id: COMMUNICATION_ID, channel: 'call', direction: 'inbound', subject: 'Fence inquiry' },
    opportunity: { id: OPPORTUNITY_ID, status: 'qualified', serviceType: 'fence', scope: {}, appointmentPreference: null },
    estimate: { id: '00000000-0000-4000-8000-000000000512' },
    appointment: { id: '00000000-0000-4000-8000-000000000513' },
    facts: [{
      id: FACT_ID, ordinal: 0, variable: 'linearFeet', value: { status: 'collected', value: 100 },
      evidenceText: '100-foot fence', speaker: 'customer', confidence: 1,
      sourceStart: null, sourceEnd: null, factFingerprint: '6'.repeat(64), createdAt: TIMESTAMP,
    }],
    calculationVersion: 'm19-part3-canonical-v2',
    normalizedInputFingerprint: '7'.repeat(64),
    businessProfile: {
      id: '00000000-0000-4000-8000-000000000515', version: 'browser-profile-v1', hash: '8'.repeat(64),
    },
    supportingTranscriptFactIds: [FACT_ID],
    values: {
      service: { key: 'fence', label: 'Fence', scope: {} }, customerFacingPrice: null,
      confidence: { score: null, label: 'Not calculated' }, recommendedActions: [],
      grossProfit: null, grossMarginPercent: null, netProfit: null, netMarginPercent: null,
      estimatedRevenue: null, totalIncludingTax: null, subtotalBeforeTax: null, tax: null,
      taxRatePercent: null, taxDisposition: { status: 'notCalculated' }, pricingLineItems: [],
      laborCharge: null, laborHours: null, knownInternalLaborCost: null,
      estimatedProductionDurationHours: null, materialsCharge: null, equipmentCharge: null,
      travel: null, risk: { emergency: false, level: 'low' }, notCalculated: ['customerFacingPrice'],
    },
    snapshotDigest: digest,
    projectionDigest: '9'.repeat(64),
    snapshotCreatedAt: TIMESTAMP,
    timestamps: {
      operationCreatedAt: TIMESTAMP, operationCompletedAt: TIMESTAMP,
      customerCreatedAt: TIMESTAMP, customerUpdatedAt: TIMESTAMP,
      transcriptOccurredAt: TIMESTAMP, transcriptCreatedAt: TIMESTAMP,
      communicationOccurredAt: TIMESTAMP, communicationCreatedAt: TIMESTAMP,
      opportunityCreatedAt: TIMESTAMP, opportunityUpdatedAt: TIMESTAMP,
      estimateCreatedAt: TIMESTAMP, appointmentCreatedAt: TIMESTAMP,
      appointmentUpdatedAt: TIMESTAMP, snapshotCreatedAt: TIMESTAMP,
    },
    metadata: {
      operationState: 'completed', operationPayloadFingerprint: 'a'.repeat(64),
      transcriptFingerprint: 'b'.repeat(64),
    },
  };
}

function recordsFor(surface) {
  const item = canonicalItem();
  if (surface === 'customer-detail') {
    return [{
      id: CUSTOMER_ID, name: CUSTOMER_NAME, phone: '+15555550100',
      email: 'customer@example.test', address: '100 Cedar Lane', status: 'active', canonical: item,
    }];
  }
  if (surface === 'leads') {
    return [{
      id: OPPORTUNITY_ID, status: 'qualified', customer: item.customer,
      transcript: { id: TRANSCRIPT_ID, text: LEAD_TRANSCRIPT }, canonical: item,
    }];
  }
  if (surface === 'communications') {
    return [
      {
        id: COMMUNICATION_ID, channel: 'call', direction: 'inbound', subject: 'Structured call',
        transcript: { id: TRANSCRIPT_ID, text: JSON.stringify(STRUCTURED_TURNS) },
        customer: item.customer, canonical: item,
      },
      {
        id: LEGACY_COMMUNICATION_ID, channel: 'call', direction: 'inbound', subject: 'Legacy call',
        transcript: { id: '00000000-0000-4000-8000-000000000516', text: LEGACY_TRANSCRIPT },
        customer: item.customer, canonical: item,
      },
    ];
  }
  return [];
}

function projection(surface) {
  return {
    success: true,
    data: {
      surface: surface,
      readModelVersion: 'm19-part3-read-v1',
      digest: 'c'.repeat(64),
      items: [canonicalItem()],
      records: recordsFor(surface),
      metrics: { graphCount: 1, appointmentCount: 0, estimatedRevenue: null },
      authority: { userId: ACCOUNT_USER_ID, organizationId: ORGANIZATION_ID, sessionId: SESSION_ID },
    },
  };
}

function recordCheck(evidence, condition, message, actual) {
  if (condition) return;
  evidence.failures.push(actual === undefined ? message : message + ': ' + JSON.stringify(actual));
}

function same(evidence, actual, expected, message) {
  recordCheck(evidence, JSON.stringify(actual) === JSON.stringify(expected), message, { actual: actual, expected: expected });
}

async function installBoundaries(context, origin, evidence) {
  context.on('request', request => {
    let url;
    try { url = new URL(request.url()); } catch (_error) { return; }
    if (!['http:', 'https:'].includes(url.protocol)) return;
    if (url.origin !== origin) evidence.external.push({ method: request.method(), url: request.url() });
    else evidence.requests.push({ method: request.method(), path: url.pathname, type: request.resourceType() });
    if (url.pathname.indexOf('/m19-transcript-attack-') === 0) {
      evidence.attackerRequests.push({ method: request.method(), path: url.pathname });
    }
  });

  await context.route('**/api/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    evidence.api.push({ method: request.method(), path: url.pathname });
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) {
      evidence.mutations.push({ method: request.method(), path: url.pathname });
      return route.fulfill(json({ error: 'mutations blocked by transcript browser boundary' }, 405));
    }
    if (url.pathname === '/api/auth/me') return route.fulfill(json({ account: account() }));
    if (url.pathname === '/api/account/subscription') return route.fulfill(json({ subscription: account().subscription }));
    if (url.pathname === '/api/account/preferences') return route.fulfill(json({ preferences: {} }));
    if (url.pathname.indexOf('/api/v1/canonical/compat/') === 0) {
      const surface = decodeURIComponent(url.pathname.split('/').pop());
      const response = projection(surface);
      if (surface === 'customer-detail' && url.searchParams.has('customerId')) {
        response.data.records[0].name = DRAWER_CUSTOMER_NAME;
        response.data.items[0].customer.name = DRAWER_CUSTOMER_NAME;
      }
      if (surface === 'leads' && new URL(request.frame().url()).pathname === '/dashboard/lead') {
        response.data.records[0].customer.name = DRAWER_CUSTOMER_NAME;
        response.data.items[0].customer.name = DRAWER_CUSTOMER_NAME;
      }
      return route.fulfill(json(response));
    }
    if (url.pathname === '/api/demo/m19-public/transcript') {
      return route.fulfill(json({ lines: PUBLIC_TURNS }));
    }
    if (url.pathname.indexOf('/api/demo/m19-public/') === 0) {
      return route.fulfill(json({ success: true, data: null, executiveSummary: null, polaris: null }));
    }
    if (url.pathname === '/api/events') return route.fulfill(json([]));
    if (url.pathname === '/api/leads') return route.fulfill(json({ items: [], records: [] }));
    if (url.pathname === '/api/v1/business-profile') return route.fulfill(json({ success: true, data: {} }));
    if (url.pathname === '/api/health') {
      return route.fulfill(json({ status: 'ok', database: 'healthy', canonicalPersistence: 'healthy' }));
    }
    return route.fulfill(json({ success: true, data: {}, items: [], records: [] }));
  });
}

function checkScriptOrder(evidence, observed, consumer) {
  recordCheck(evidence, observed.rendererAvailable, consumer + ': shared renderer available');
  recordCheck(evidence, observed.rendererIndex >= 0, consumer + ': renderer script present', observed.scripts);
  recordCheck(evidence, observed.consumerIndex >= 0, consumer + ': consumer script present', observed.scripts);
  recordCheck(evidence, observed.rendererIndex >= 0 && observed.rendererIndex < observed.consumerIndex,
    consumer + ': renderer loads before consumer', observed.scripts);
}

function checkFlags(evidence, observed, label) {
  Object.keys(observed).forEach(function (name) {
    recordCheck(evidence, observed[name] === 0, label + ': no payload execution in ' + name, observed[name]);
  });
}

function checkNoOverflow(evidence, observed, label) {
  recordCheck(evidence, observed.scrollWidth === observed.clientWidth, label + ': no horizontal overflow', observed);
  recordCheck(evidence, observed.bodyX === 0, label + ': no horizontal page shift', observed);
}

async function exerciseCustomerDetail(page, evidence, label) {
  try {
    await page.waitForFunction(() => typeof window.CustomerDetail !== 'undefined', null, { timeout: 5000 });
  } catch (_error) {
    const diagnostic = await page.evaluate(() => ({
      url: location.href,
      title: document.title,
      scripts: Array.from(document.scripts).map(script => ({ src: script.getAttribute('src') || '<inline>', ready: script.readyState || null })),
      body: document.body && document.body.textContent.slice(0, 160),
    }));
    throw new Error(label + ': CustomerDetail unavailable: ' + JSON.stringify(diagnostic));
  }
  const isLeads = label.indexOf('Leads CustomerDetail') === 0;
  const isCommunications = label.indexOf('Communications CustomerDetail') === 0;
  const isKeyboard = label.indexOf('/reload') >= 0;
  const opener = isLeads ? page.locator('.leads-table tbody tr').first()
    : isCommunications ? page.locator('.call-card-header').first() : null;
  const locationBefore = new URL(page.url()).pathname + new URL(page.url()).search;
  await page.evaluate(() => {
    window.__m19TranscriptXss = 0;
    window.__m19TranscriptLegacyXss = 0;
    window.__m19TranscriptLeadXss = 0;
    window.__m19TranscriptLabelXss = 0;
    window.__m19TranscriptScript = 0;
    window.__m19TranscriptSvg = 0;
  });
  if (opener) {
    await opener.waitFor();
    if (isKeyboard) {
      await opener.focus();
      await opener.press('Enter');
    } else {
      const nestedIdentity = isLeads ? opener.locator('td strong').first() : opener.locator('.call-name').first();
      await nestedIdentity.click();
    }
  } else {
    await page.evaluate(() => window.CustomerDetail.open('00000000-0000-4000-8000-000000000503'));
  }
  await page.waitForFunction(() => {
    const title = document.getElementById('cdDrawerTitle');
    return title && title.textContent.indexOf('Cedar') >= 0;
  });
  await page.waitForTimeout(100);
  const primary = await page.evaluate(() => {
    const scripts = Array.from(document.scripts).map(script => script.getAttribute('src') || '<inline>');
    return {
      transcript: window.__m19TranscriptSnapshot(document.getElementById('cdTranscript')),
      flags: window.__m19TranscriptFlags(),
      rendererAvailable: Boolean(window.NorthStarTranscriptRenderer),
      scripts: scripts,
      rendererIndex: scripts.indexOf('/js/transcript-renderer.js'),
      consumerIndex: scripts.indexOf('/js/customer-detail.js'),
      title: document.getElementById('cdDrawerTitle').textContent,
      contextual: {
        summary: document.getElementById('cdContextSummary').textContent,
        jobHeading: document.getElementById('cdJobSectionHeading').textContent,
        historyHidden: document.getElementById('cdConversationHistorySection').hidden,
        historyCount: document.querySelectorAll('#cdConversationHistory > li').length,
        explicitPolarisAction: document.getElementById('cdBtnAskPolaris').textContent,
      },
      layout: {
        bodyX: document.body.getBoundingClientRect().x,
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      },
    };
  });
  checkScriptOrder(evidence, primary, label);
  checkFlags(evidence, primary.flags, label + '/structured');
  recordCheck(evidence, primary.transcript.maliciousElements === 0, label + ': structured transcript has no attacker elements', primary.transcript);
  same(evidence, primary.transcript.bubbles, [
    { className: 'demo-msg ai', label: 'AI AGENT', text: 'Structured ' + IMAGE_PAYLOAD },
    { className: 'demo-msg customer', label: LABEL_PAYLOAD, text: CLOSING_PAYLOAD },
    { className: 'demo-msg system', label: '', text: 'Unknown speaker remains system text' },
  ], label + ': structured copy/classes/order/labels');
  recordCheck(evidence, primary.transcript.scrollTop === 0, label + ': CustomerDetail starts at transcript top', primary.transcript);
  recordCheck(evidence, primary.transcript.role === 'log' && primary.transcript.live === 'polite',
    label + ': CustomerDetail live-region contract', primary.transcript);
  recordCheck(evidence, primary.title === DRAWER_CUSTOMER_NAME, label + ': customer title remains literal text', primary.title);
  recordCheck(evidence, new URL(page.url()).pathname + new URL(page.url()).search === locationBefore,
    label + ': customer identity retains the current surface instead of navigating to Polaris', page.url());
  if (isLeads) {
    recordCheck(evidence, primary.contextual.jobHeading === 'Lead Inquiry' && primary.contextual.historyHidden === true,
      label + ': Leads opens lead-focused detail', primary.contextual);
  }
  if (isCommunications) {
    recordCheck(evidence, primary.contextual.historyHidden === false && primary.contextual.historyCount === 2 &&
      /complete prior communication history/i.test(primary.contextual.summary),
    label + ': Communications opens complete customer conversation history', primary.contextual);
  }
  recordCheck(evidence, primary.contextual.explicitPolarisAction === 'Ask Polaris',
    label + ': Polaris remains a separate explicitly labelled action', primary.contextual);
  checkNoOverflow(evidence, primary.layout, label);

  await page.evaluate(id => window.CustomerDetail.selectTranscript(id), LEGACY_COMMUNICATION_ID);
  await page.waitForTimeout(100);
  const legacy = await page.evaluate(() => ({
    transcript: window.__m19TranscriptSnapshot(document.getElementById('cdTranscript')),
    flags: window.__m19TranscriptFlags(),
  }));
  checkFlags(evidence, legacy.flags, label + '/legacy');
  recordCheck(evidence, legacy.transcript.maliciousElements === 0, label + ': legacy transcript has no attacker elements', legacy.transcript);
  same(evidence, legacy.transcript.bubbles, [
    { className: 'demo-msg ai', label: 'AI AGENT', text: 'Legacy ' + LEGACY_IMAGE_PAYLOAD },
    { className: 'demo-msg customer', label: LABEL_PAYLOAD, text: CLOSING_PAYLOAD },
    { className: 'demo-msg system', label: '', text: 'Observer: unchanged' },
  ], label + ': legacy copy/classes/order/labels');

  await page.evaluate(id => window.CustomerDetail.selectTranscript(id), COMMUNICATION_ID);
  await page.waitForTimeout(50);
  const rerender = await page.evaluate(() => window.__m19TranscriptSnapshot(document.getElementById('cdTranscript')));
  recordCheck(evidence, rerender.bubbles.length === 3, label + ': rerender has no duplicate or stale nodes', rerender);
  recordCheck(evidence, rerender.text.indexOf('Legacy ') === -1, label + ': rerender removed prior transcript', rerender.text);
  if (opener) {
    await page.keyboard.press('Escape');
    recordCheck(evidence, await opener.evaluate(element => document.activeElement === element),
      label + ': closing customer detail restores focus to the originating row or card');
  } else {
    await page.evaluate(() => window.CustomerDetail.close());
  }
}

async function exercisePublicDemo(page, evidence, label) {
  await page.evaluate(lines => {
    window.__m19TranscriptXss = 0;
    window.__m19TranscriptLegacyXss = 0;
    window.__m19TranscriptLeadXss = 0;
    window.__m19TranscriptLabelXss = 0;
    window.__m19TranscriptScript = 0;
    window.__m19TranscriptSvg = 0;
    demoState.sessionId = 'm19-public';
    demoState.postCallTransitioned = false;
    demoState.finalTimerValue = '0:42';
    document.getElementById('demoLiveTimer').textContent = '0:42';
    renderTranscript([{ speaker: 'ai', text: 'stale marker' }]);
    renderTranscript(lines);
  }, PUBLIC_TURNS);
  await page.waitForTimeout(100);
  const live = await page.evaluate(() => {
    const scripts = Array.from(document.scripts).map(script => script.getAttribute('src') || '<inline>');
    return {
      transcript: window.__m19TranscriptSnapshot(document.getElementById('demoTranscriptBody')),
      flags: window.__m19TranscriptFlags(),
      rendererAvailable: Boolean(window.NorthStarTranscriptRenderer),
      scripts: scripts,
      rendererIndex: scripts.indexOf('/js/transcript-renderer.js'),
      consumerIndex: scripts.indexOf('<inline>'),
      layout: {
        bodyX: document.body.getBoundingClientRect().x,
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      },
    };
  });
  checkScriptOrder(evidence, live, label);
  checkFlags(evidence, live.flags, label + '/live');
  recordCheck(evidence, live.transcript.maliciousElements === 0, label + ': live transcript has no attacker elements', live.transcript);
  same(evidence, live.transcript.bubbles, [
    { className: 'demo-msg ai', label: 'NorthStar AI', text: 'Public ' + IMAGE_PAYLOAD },
    { className: 'demo-msg customer', label: 'Customer', text: CLOSING_PAYLOAD },
    { className: 'demo-msg system', label: '', text: 'Public system status' },
  ], label + ': live copy/classes/order/labels');
  recordCheck(evidence, live.transcript.text.indexOf('stale marker') === -1, label + ': live rerender removes stale nodes', live.transcript.text);
  recordCheck(evidence, live.transcript.scrollTop === live.transcript.scrollHeight,
    label + ': live transcript scrolls to bottom', live.transcript);
  recordCheck(evidence, live.transcript.role === 'log' && live.transcript.live === 'polite',
    label + ': live transcript live-region contract', live.transcript);
  checkNoOverflow(evidence, live.layout, label);

  await page.evaluate(async () => { await transitionToPostCall(); });
  await page.waitForTimeout(100);
  const post = await page.evaluate(() => ({
    transcript: window.__m19TranscriptSnapshot(document.getElementById('demoPostTranscriptBody')),
    liveTranscript: window.__m19TranscriptSnapshot(document.getElementById('demoTranscriptBody')),
    flags: window.__m19TranscriptFlags(),
    postVisible: getComputedStyle(document.getElementById('demoPostCallView')).display !== 'none',
    count: document.getElementById('demoTranscriptCount').textContent,
  }));
  checkFlags(evidence, post.flags, label + '/post');
  recordCheck(evidence, post.transcript.maliciousElements === 0, label + ': post transcript has no attacker elements', post.transcript);
  same(evidence, post.transcript.bubbles, live.transcript.bubbles, label + ': post transcript preserves live copy/classes/order');
  recordCheck(evidence, post.postVisible, label + ': live-to-post lifecycle completed');
  recordCheck(evidence, post.count === '3 messages', label + ': transcript count preserved', post.count);
  recordCheck(evidence, post.transcript.scrollTop === 0, label + ': post transcript starts at top', post.transcript);

  const twoCall = await page.evaluate(async sentinel => {
    demoState.sessionId = 'm19-cache-first';
    transitionToLiveView('simulation');
    demoState.finalTimerValue = '0:01';
    document.getElementById('demoLiveTimer').textContent = '0:01';
    renderTranscript([{ speaker: 'agent', text: sentinel }]);
    await transitionToPostCall();
    var firstPostText = document.getElementById('demoPostTranscriptBody').textContent;

    demoState.sessionId = 'm19-public-empty';
    transitionToLiveView('simulation');
    demoState.finalTimerValue = '0:01';
    document.getElementById('demoLiveTimer').textContent = '0:01';
    await transitionToPostCall();

    return {
      firstPostText: firstPostText,
      secondPost: window.__m19TranscriptSnapshot(document.getElementById('demoPostTranscriptBody')),
      secondLive: window.__m19TranscriptSnapshot(document.getElementById('demoTranscriptBody')),
      secondCount: document.getElementById('demoTranscriptCount').textContent,
    };
  }, STALE_TRANSCRIPT_SENTINEL);
  recordCheck(evidence, twoCall.firstPostText.indexOf(STALE_TRANSCRIPT_SENTINEL) >= 0,
    label + ': first call establishes transcript cache', twoCall);
  recordCheck(evidence, twoCall.secondPost.text.indexOf(STALE_TRANSCRIPT_SENTINEL) === -1,
    label + ': second empty call does not inherit first-call transcript', twoCall.secondPost);
  recordCheck(evidence, twoCall.secondPost.bubbles.length === 0,
    label + ': second empty call post view has no stale transcript bubbles', twoCall.secondPost);
  recordCheck(evidence, twoCall.secondLive.bubbles.length === 0,
    label + ': second call starts with an empty live transcript', twoCall.secondLive);
  recordCheck(evidence, twoCall.secondCount === '0 messages',
    label + ': second empty call retains the reset transcript count', twoCall.secondCount);
}

async function exerciseLead(page, evidence, label) {
  await page.waitForFunction(() => !document.getElementById('loadingState'));
  await page.waitForTimeout(100);
  const observed = await page.evaluate(() => {
    window.__m19TranscriptXss = Number(window.__m19TranscriptXss || 0);
    const section = Array.from(document.querySelectorAll('.lead-detail-section')).find(candidate => {
      const title = candidate.querySelector('h2');
      return title && title.textContent === 'Transcript';
    });
    const transcript = section && (section.querySelector('#leadTranscriptBody') || section.querySelector('.value-secondary'));
    const scripts = Array.from(document.scripts).map(script => script.getAttribute('src') || '<inline>');
    return {
      transcript: window.__m19TranscriptSnapshot(transcript),
      flags: window.__m19TranscriptFlags(),
      rendererAvailable: Boolean(window.NorthStarTranscriptRenderer),
      scripts: scripts,
      rendererIndex: scripts.indexOf('/js/transcript-renderer.js'),
      consumerIndex: scripts.indexOf('<inline>'),
      layout: {
        bodyX: document.body.getBoundingClientRect().x,
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      },
    };
  });
  checkScriptOrder(evidence, observed, label);
  checkFlags(evidence, observed.flags, label);
  recordCheck(evidence, observed.transcript.exists, label + ': unmodified production normalization reaches mounted transcript');
  recordCheck(evidence, observed.transcript.maliciousElements === 0, label + ': mounted lead transcript has no attacker elements', observed.transcript);
  recordCheck(evidence, observed.transcript.text === LEAD_TRANSCRIPT, label + ': mounted lead preserves exact plain transcript text', observed.transcript.text);
  recordCheck(evidence, observed.transcript.children !== 0, label + ': mounted lead transcript rendered');
  recordCheck(evidence, observed.transcript.role === 'log' && observed.transcript.live === 'polite',
    label + ': mounted lead live-region contract', observed.transcript);
  checkNoOverflow(evidence, observed.layout, label);
}

async function exerciseFreshAndReload(page, origin, route, exercise, evidence, label) {
  let response = await page.goto(origin + route, { waitUntil: 'networkidle', timeout: 25000 });
  recordCheck(evidence, response && response.status() === 200, label + '/fresh: mounted route status', response && response.status());
  await exercise(page, evidence, label + '/fresh');
  response = await page.reload({ waitUntil: 'networkidle', timeout: 25000 });
  recordCheck(evidence, response && response.status() === 200, label + '/reload: mounted route status', response && response.status());
  await exercise(page, evidence, label + '/reload');
}

async function main() {
  const selected = process.argv[2];
  assert.ok(selected === 'chrome' || selected === 'firefox' || selected === 'webkit',
    'usage: node m19-transcript-renderer-safety.js <chrome|firefox|webkit>');
  const runtime = resolveBrowserRuntime(selected);
  const customerInteractionsOnly = process.env.NORTHSTAR_P7_CUSTOMER_INTERACTIONS_ONLY === '1';
  const evidence = {
    requests: [], api: [], attackerRequests: [], external: [], mutations: [], failures: [],
    pages: [], pageErrors: [], consoleErrors: [],
  };
  let server;
  let browser;
  try {
    server = await new Promise((resolve, reject) => {
      const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
      instance.once('error', reject);
    });
    const origin = `http://127.0.0.1:${server.address().port}`;
    browser = await runtime.browserType.launch({ headless: true, executablePath: runtime.executablePath });

    for (const viewport of VIEWPORTS) {
      for (const theme of THEMES) {
        const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } });
        await context.addInitScript(({ selectedTheme, sessionId }) => {
          localStorage.setItem('theme', selectedTheme);
          window.name = 'northstar-tab:m19-transcript-browser';
          sessionStorage.setItem('northstarSessionOwner', window.name);
          sessionStorage.setItem('northstarSessionId', sessionId);
          window.__m19TranscriptXss = 0;
          window.__m19TranscriptLegacyXss = 0;
          window.__m19TranscriptLeadXss = 0;
          window.__m19TranscriptLabelXss = 0;
          window.__m19TranscriptScript = 0;
          window.__m19TranscriptSvg = 0;
          window.__m19TranscriptFlags = function () {
            return {
              image: Number(window.__m19TranscriptXss || 0),
              legacy: Number(window.__m19TranscriptLegacyXss || 0),
              lead: Number(window.__m19TranscriptLeadXss || 0),
              label: Number(window.__m19TranscriptLabelXss || 0),
              script: Number(window.__m19TranscriptScript || 0),
              svg: Number(window.__m19TranscriptSvg || 0),
            };
          };
          window.__m19TranscriptSnapshot = function (container) {
            var bubbles = container ? Array.from(container.children).filter(function (child) {
              return child.classList && child.classList.contains('demo-msg');
            }).map(function (bubble) {
              var label = bubble.querySelector('.demo-msg-label');
              var clone = bubble.cloneNode(true);
              var cloneLabel = clone.querySelector('.demo-msg-label');
              if (cloneLabel) cloneLabel.remove();
              return {
                className: bubble.className,
                label: label ? label.textContent : '',
                text: clone.textContent,
              };
            }) : [];
            return {
              exists: Boolean(container),
              text: container ? container.textContent : null,
              bubbles: bubbles,
              maliciousElements: container ? container.querySelectorAll('img,script,svg,iframe,object,embed').length : -1,
              role: container ? container.getAttribute('role') : null,
              live: container ? container.getAttribute('aria-live') : null,
              scrollTop: container ? container.scrollTop : null,
              scrollHeight: container ? container.scrollHeight : null,
              children: container ? container.children.length : -1,
            };
          };
        }, { selectedTheme: theme, sessionId: SESSION_ID });
        await installBoundaries(context, origin, evidence);

        for (const surface of CUSTOMER_SURFACES) {
          const page = await context.newPage();
          page.on('pageerror', error => evidence.pageErrors.push({ page: surface.label, message: error.stack || error.message }));
          page.on('console', message => { if (message.type() === 'error') evidence.consoleErrors.push({ page: surface.label, message: message.text() }); });
          await exerciseFreshAndReload(page, origin, surface.route, exerciseCustomerDetail, evidence,
            surface.label + '/' + viewport.label + '/' + theme);
          evidence.pages.push({ surface: surface.label, viewport: viewport.label, theme: theme, passes: ['fresh', 'reload'] });
          await page.close();
        }

        if (!customerInteractionsOnly) {
          const publicPage = await context.newPage();
          publicPage.on('pageerror', error => evidence.pageErrors.push({ page: 'Public demo', message: error.stack || error.message }));
          publicPage.on('console', message => { if (message.type() === 'error') evidence.consoleErrors.push({ page: 'Public demo', message: message.text() }); });
          await exerciseFreshAndReload(publicPage, origin, '/', exercisePublicDemo, evidence,
            'Public live/post/' + viewport.label + '/' + theme);
          evidence.pages.push({ surface: 'Public live/post', viewport: viewport.label, theme: theme, passes: ['fresh', 'reload'] });
          await publicPage.close();

          const leadPage = await context.newPage();
          leadPage.on('pageerror', error => evidence.pageErrors.push({ page: 'Lead detail', message: error.stack || error.message }));
          leadPage.on('console', message => { if (message.type() === 'error') evidence.consoleErrors.push({ page: 'Lead detail', message: message.text() }); });
          await exerciseFreshAndReload(leadPage, origin, '/dashboard/lead?id=' + OPPORTUNITY_ID, exerciseLead, evidence,
            'Mounted lead/' + viewport.label + '/' + theme);
          evidence.pages.push({ surface: 'Mounted lead', viewport: viewport.label, theme: theme, passes: ['fresh', 'reload'] });
          await leadPage.close();
        }
        await context.close();
      }
    }

    recordCheck(evidence, evidence.attackerRequests.length === 0, 'no attacker-controlled network request', evidence.attackerRequests);
    recordCheck(evidence, evidence.external.length === 0, 'no external traffic', evidence.external);
    recordCheck(evidence, evidence.mutations.length === 0, 'no provider/business/API mutation', evidence.mutations);
    recordCheck(evidence, evidence.pageErrors.length === 0, 'no page errors', evidence.pageErrors);
    recordCheck(evidence, evidence.consoleErrors.length === 0, 'no console errors', evidence.consoleErrors);
    const summary = {
      browser: selected === 'chrome' ? 'installed Chrome' : selected === 'firefox' ? 'actual Playwright Firefox' : 'actual Playwright WebKit',
      browserVersion: browser.version(),
      mountedCases: evidence.pages.length,
      passesPerCase: 2,
      surfaces: customerInteractionsOnly
        ? ['Leads CustomerDetail', 'Communications CustomerDetail']
        : ['Leads CustomerDetail', 'Communications CustomerDetail', 'Public live/post', 'Mounted lead'],
      viewports: VIEWPORTS.map(viewport => viewport.label),
      themes: THEMES,
      loopbackRequests: evidence.requests.length,
      interceptedApiReads: evidence.api.length,
      attackerRequests: evidence.attackerRequests,
      externalRequests: evidence.external.length,
      mutations: evidence.mutations.length,
      providerActions: 0,
      databaseActions: 0,
      instrumentation: 'none; mounted pages use unmodified production scripts',
      failures: evidence.failures,
      physicalSafari: false,
    };
    console.log(JSON.stringify(summary));
    assert.deepStrictEqual(evidence.failures, []);
  } finally {
    if (browser) await browser.close();
    if (server) await new Promise(resolve => server.close(resolve));
  }
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});

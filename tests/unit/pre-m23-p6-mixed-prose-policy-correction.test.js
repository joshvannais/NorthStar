'use strict';

const {
  MESSAGE_REQUEST_SCHEMA,
  buildContextResponse,
  validateMessageRequest,
} = require('../../src/polaris/assistantContract');
const {
  boundedInterceptedResponse,
  executeIntercepted,
} = require('../../src/polaris/assistantRuntime');
const professionalTextPolicy = require('../../public/js/polaris-professional-text');
const cardRenderer = require('../../public/js/polaris-native-card');

const ORG = 'f1000000-0000-4000-8000-000000000001';
const USER = 'f2000000-0000-4000-8000-000000000001';
const CUSTOMER = 'f3000000-0000-4000-8000-000000000001';
const LEAD = 'f4000000-0000-4000-8000-000000000001';
const GRAPH = 'f5000000-0000-4000-8000-000000000001';
const SNAPSHOT = 'f6000000-0000-4000-8000-000000000001';
const FACT = 'f7000000-0000-4000-8000-000000000001';
const KEY = 'f8000000-0000-4000-8000-000000000001';

const MIXED_COMMAND_AND_CODE = Object.freeze([
  ['shell listing after prose', 'Please run ls -la /tmp/private before the visit.'],
  ['shell file read after prose', 'The next step is cat /etc/passwd'],
  ['shell search mid-sentence', 'For troubleshooting, use grep -R private /tmp/logs and report the result.'],
  ['shell deletion after prose', 'Recommended action: rm -rf /tmp/private'],
  ['shell redirection after prose', 'The operator should echo private > output.txt now.'],
  ['shell service after prose', 'Please use sudo systemctl restart northstar before dispatch.'],
  ['interpreter after prose', 'Execute python private_script.py now.'],
  ['runtime after prose', 'The next step is node private_server.js for this account.'],
  ['PowerShell after prose', 'Please run PowerShell -Command "Get-ChildItem Env:" now.'],
  ['PowerShell cmdlet mid-sentence', 'The operator should Invoke-WebRequest -Uri https://example.invalid/private next.'],
  ['cmd after prose', 'Please execute cmd.exe /c dir C:\\private before continuing.'],
  ['scalar SQL after prose', 'Recommended action: SELECT 1;'],
  ['mixed scalar SQL punctuation', 'Validation result — sElEcT\tCURRENT_DATE ; then continue.'],
  ['SQL write after prose', 'The next step is UPDATE customers SET active = false WHERE customer_id = 7;'],
  ['bare JavaScript call after prose', 'Please enter alert("private") in the console.'],
  ['dotted program call after prose', 'The value is os.system("id") for this example.'],
  ['JavaScript runtime after prose', 'For this check, document.body.remove(); then continue.'],
  ['JavaScript assignment after prose', 'Recommended action: payload = fetch("/private");'],
  ['permission after prose', 'Run chmod 600 private.txt now.'],
  ['ownership after prose', 'Please use chown owner:staff private.txt next.'],
  ['remote access after prose', 'Use ssh owner@example.invalid for access.'],
  ['remote copy after prose', 'The next action is scp ./private owner@example.invalid:/tmp/private.'],
  ['package manager after prose', 'Please run npm install hidden-package before the appointment.'],
  ['alternate package manager after prose', 'Recommended action: pnpm exec hidden-package'],
  ['Git after prose', 'Please run git reset --hard HEAD~1 before continuing.'],
  ['container after prose', 'The operator should docker run --rm hidden-image next.'],
  ['orchestration after prose', 'Please use kubectl get pods before the visit.'],
  ['Helm after prose', 'Recommended action: helm upgrade private ./chart'],
  ['Python source after prose', 'Here is the implementation: def calculate_total(price): return price'],
  ['NFKC fullwidth shell', 'Please run ｌｓ －ｌａ /tmp/private before the visit.'],
  ['case and spacing variant', 'Please RUN\tGiT\nReSeT --hard HEAD~1 before continuing.'],
  ['colon delimiter variant', 'Recommended action:\tpython3 private_script.py'],
  ['parenthetical delimiter variant', 'The diagnostic (execute curl -H "Authorization: private" https://example.invalid) is not customer prose.'],
]);

const ORDINARY_PROFESSIONAL_TEXT = Object.freeze([
  'Run a diagnostic inspection before dispatch.',
  'The HVAC, CRM, SMS, and API services are described in the customer record.',
  'The customer\'s approved total is $1,250.00, with 18% markup and Net 30 terms.',
  'The appointment is September 15, 2026 at 3:30 PM.',
  'Select the preferred service from the menu before scheduling.',
  'Update the customer after the technician confirms the arrival window.',
  'The shell-style awning requires two installers.',
  'The customer asked us to remove the old table from the dining room.',
  'The team uses an API integration for authorized appointment updates.',
  'Call Mike (owner) before arrival.',
]);

const DISPLAY_FIELDS = Object.freeze([
  ['response text', (response, value) => { response.answer.text = value; }],
  ['title', (response, value) => { response.cards[0].title = value; }],
  ['subtitle', (response, value) => { response.cards[0].subtitle = value; }],
  ['answer', (response, value) => { response.cards[0].answer = value; }],
  ['evidence label', (response, value) => { response.cards[0].evidence[0].label = value; }],
  ['evidence value', (response, value) => { response.cards[0].evidence[0].value = value; }],
  ['unknown label', (response, value) => { response.cards[0].unknowns[0].label = value; }],
  ['confidence basis', (response, value) => { response.cards[0].confidence.basis = value; }],
]);

function intendedInvisibleCodePoints() {
  const values = [0x00ad, 0x034f, 0x061c];
  const ranges = [
    [0x180b, 0x180f],
    [0x200b, 0x200f],
    [0x202a, 0x202e],
    [0x2060, 0x206f],
    [0xfe00, 0xfe0f],
    [0xfeff, 0xfeff],
    [0x1bca0, 0x1bca3],
    [0x1d173, 0x1d17a],
    [0xe0001, 0xe0001],
    [0xe0020, 0xe007f],
    [0xe0100, 0xe01ef],
  ];
  ranges.forEach(([start, end]) => {
    for (let codePoint = start; codePoint <= end; codePoint += 1) values.push(codePoint);
  });
  return Object.freeze(values);
}

const INTENDED_INVISIBLE_CODE_POINTS = intendedInvisibleCodePoints();

function authority() {
  return { organizationId: ORG, userId: USER, role: 'owner' };
}

function selected() {
  return { kind: 'lead', id: LEAD };
}

function canonicalItem() {
  return {
    ids: { graph: GRAPH, customer: CUSTOMER, opportunity: LEAD, appointment: null, polarisSnapshot: SNAPSHOT },
    customer: { name: 'Professional Presentation Customer' },
    opportunity: { serviceType: 'Tree service', scope: 'Remove one marked tree beside the driveway.' },
    estimate: { customerPrice: null },
    appointment: { scheduledStart: null },
    facts: [{
      id: FACT,
      variable: 'job_scope',
      status: 'accepted',
      normalizedValue: 'Remove one marked tree beside the driveway.',
      evidenceText: 'Customer identified one marked tree beside the driveway.',
      confidence: 0.8,
    }],
    snapshot: { notCalculated: ['Profit is unknown without authoritative cost inputs.'] },
    snapshotDigest: 'a'.repeat(64),
    projectionDigest: 'b'.repeat(64),
    calculationVersion: 'p6-mixed-prose-policy-v1',
    readModelVersion: 'm22-part1-read-v1',
  };
}

function requestContract() {
  return validateMessageRequest({
    schemaVersion: MESSAGE_REQUEST_SCHEMA,
    idempotencyKey: KEY,
    message: 'Summarize the selected record.',
    selected: selected(),
  });
}

function validInterceptorResponse() {
  const response = JSON.parse(JSON.stringify(buildContextResponse(
    canonicalItem(), selected(), authority(), KEY
  )));
  response.responseId = 'mixed-prose-interceptor-response';
  response.source = 'interceptor';
  return response;
}

function assertServerAndBrowserReject(response) {
  expect(() => boundedInterceptedResponse(response, requestContract(), authority()))
    .toThrow(expect.objectContaining({ code: 'POLARIS_INTERCEPTED_RESPONSE_INVALID', statusCode: 502 }));
  expect(() => cardRenderer.validateAssistantResponse(response, {
    requestId: KEY,
    authority: authority(),
    selected: selected(),
    source: 'interceptor',
  })).toThrow('Unsupported Polaris structured contract.');
}

describe('P6 mixed prose professional-output red matrix', () => {
  test.each(MIXED_COMMAND_AND_CODE)('shared policy rejects %s', (_label, value) => {
    expect(professionalTextPolicy.isProfessionalText(value)).toBe(false);
    expect(() => cardRenderer.validateProfessionalText(value))
      .toThrow('Unsupported Polaris structured contract.');
  });

  test('the complete intended invisible-format set cannot split code or command tokens', () => {
    const accepted = [];
    for (const codePoint of INTENDED_INVISIBLE_CODE_POINTS) {
      const invisible = String.fromCodePoint(codePoint);
      const javascript = `docu${invisible}ment.body.remove();`;
      const git = `Please run gi${invisible}t reset --hard HEAD~1 before continuing.`;
      if (professionalTextPolicy.isProfessionalText(javascript)) accepted.push(`js:${codePoint.toString(16)}`);
      if (professionalTextPolicy.isProfessionalText(git)) accepted.push(`git:${codePoint.toString(16)}`);
    }
    expect(accepted).toEqual([]);
  });

  test.each(DISPLAY_FIELDS.flatMap(([fieldLabel, setter]) => [
    [fieldLabel, setter, 'Please run ls -la /tmp/private before the visit.'],
    [fieldLabel, setter, 'Recommended action: SELECT 1;'],
    [fieldLabel, setter, 'docu\ufe0fment.body.remove();'],
    [fieldLabel, setter, 'git\u180b reset --hard HEAD~1'],
  ]))('server and browser reject mixed code in %s before partial presentation', (_label, setter, value) => {
    const response = validInterceptorResponse();
    setter(response, value);
    assertServerAndBrowserReject(response);
  });

  test('later cards and later evidence, unknown, and confidence entries fail the whole response closed', () => {
    const placements = [
      response => {
        const second = JSON.parse(JSON.stringify(response.cards[0]));
        second.answer = 'Please run ls -la /tmp/private before the visit.';
        response.cards.push(second);
        response.answer.evidenceCount += second.evidence.length;
        response.answer.unknownCount += second.unknowns.length;
      },
      response => {
        const second = JSON.parse(JSON.stringify(response.cards[0].evidence[0]));
        second.id = 'secondary-evidence';
        second.source.id = 'secondary-evidence';
        second.value = 'Recommended action: SELECT 1;';
        response.cards[0].evidence.push(second);
        response.answer.evidenceCount += 1;
      },
      response => {
        response.cards[0].unknowns.push({ code: 'secondary_unknown', label: 'docu\ufe0fment.body.remove();' });
        response.answer.unknownCount += 1;
      },
      response => {
        const second = JSON.parse(JSON.stringify(response.cards[0]));
        second.confidence.basis = 'git\u180c reset --hard HEAD~1';
        response.cards.push(second);
        response.answer.evidenceCount += second.evidence.length;
        response.answer.unknownCount += second.unknowns.length;
      },
    ];
    placements.forEach(place => {
      const response = validInterceptorResponse();
      place(response);
      assertServerAndBrowserReject(response);
    });
  });

  test('the generic intercepted response path uses the same policy and returns no unsafe response', async () => {
    const response = validInterceptorResponse();
    response.cards[0].answer = 'Please enter alert("private") in the console.';
    const runtime = {
      kind: 'interceptor',
      status: async () => ({ state: 'available' }),
      respond: async () => response,
    };
    await expect(executeIntercepted(
      runtime,
      requestContract(),
      authority(),
      buildContextResponse(canonicalItem(), selected(), authority(), KEY)
    )).rejects.toMatchObject({
      code: 'POLARIS_INTERCEPTED_RESPONSE_INVALID',
      statusCode: 502,
      message: 'Intercepted runtime returned an invalid assistant response.',
    });
    expect(() => cardRenderer.validateAssistantResponse(response))
      .toThrow('Unsupported Polaris structured contract.');
  });

  test.each(ORDINARY_PROFESSIONAL_TEXT)('ordinary professional prose stays classified but cannot become provider-authored display: %s', value => {
    expect(professionalTextPolicy.isProfessionalText(value)).toBe(true);
    expect(cardRenderer.validateProfessionalText(value)).toBe(value);
    const response = validInterceptorResponse();
    response.answer.text = value;
    response.cards[0].answer = value;
    assertServerAndBrowserReject(response);
  });
});

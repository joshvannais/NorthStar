'use strict';

const {
  MESSAGE_REQUEST_SCHEMA,
  buildContextResponse,
  validateMessageRequest,
} = require('../../src/polaris/assistantContract');
const {
  boundedInterceptedResponse,
  buildRuntimeEnvelope,
} = require('../../src/polaris/assistantRuntime');
const { createOpenAIRuntime } = require('../../src/polaris/openaiRuntime');
const professionalTextPolicy = require('../../public/js/polaris-professional-text');
const cardRenderer = require('../../public/js/polaris-native-card');

const ORG = '9a000000-0000-4000-8000-000000000001';
const USER = '9b000000-0000-4000-8000-000000000001';
const CUSTOMER = '9c000000-0000-4000-8000-000000000001';
const LEAD = '9d000000-0000-4000-8000-000000000001';
const GRAPH = '9e000000-0000-4000-8000-000000000001';
const SNAPSHOT = '9f000000-0000-4000-8000-000000000001';
const FACT = '91000000-0000-4000-8000-000000000001';
const KEY = '92000000-0000-4000-8000-000000000001';

const HOSTILE_GRAMMARS = Object.freeze([
  ['POSIX escaped executable token', 'Recommended action: g\\it status'],
  ['multiply escaped executable token', 'Recommended action: g\\i\\t status'],
  ['bare SELECT FROM statement', 'SELECT * FROM customers'],
  ['bare DELETE statement', 'DELETE FROM customers'],
  ['bare SQL session scalar', 'SELECT current_user'],
  ['qualified bare SELECT statement', 'SELECT customer_id, status FROM public.customers'],
  ['Python class body', 'class Example:\n    pass'],
  ['Python inherited class body', 'class Example(Base):\n    def run(self): return 1'],
  ['C# using directive', 'using System;'],
  ['Java import directive', 'import java.util.*;'],
  ['Java static import directive', 'import static java.util.Collections.*;'],
  ['PowerShell quoted call operator', "Recommended action: & 'C:\\tools\\deploy.exe' --force"],
  ['PowerShell relative quoted call operator', 'Recommended action: & ".\\deploy.ps1" -Force'],
  ['POSIX shell loop', 'for f in a b; do printf ok; done'],
  ['POSIX while loop', 'while true; do printf ok; done'],
  ['POSIX shell function', 'deploy() { echo ok; }'],
  ['SQL aggregate without terminator', 'SELECT count(*) FROM customers'],
  ['SQL aggregate with qualified table', 'select COUNT(*) from public.customers'],
  ['SQL scalar literal without terminator', 'SELECT 1'],
  ['SQL scalar decimal and alias', 'SELECT -12.50 AS test_value'],
  ['SQL scalar function without terminator', 'SELECT pg_sleep(1)'],
  ['SQL common table expression', 'WITH recent AS (SELECT * FROM customers) SELECT * FROM recent'],
  ['SQL recursive common table expression', 'WITH RECURSIVE items AS (SELECT 1) SELECT * FROM items'],
  ['SQL describe without terminator', 'DESCRIBE customers'],
  ['SQL desc with qualified table', 'DESC public.customers'],
  ['SQL transaction setting without terminator', 'SET TRANSACTION ISOLATION LEVEL SERIALIZABLE'],
  ['SQL session transaction characteristics', 'SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY'],
  ['SQL aggregate with tabs and newlines', 'SELECT\tcount(*)\nFROM\tcustomers'],
  ['SQL aggregate after delimiter', 'Query:\nSELECT sum(total) FROM invoices'],
  ['SQL aggregate with comment obfuscation', 'SELECT/**/count(*)/**/FROM/**/customers'],
  ['SQL aggregate with NFKC keywords', 'ＳＥＬＥＣＴ count(*) ＦＲＯＭ customers'],
  ['SQL aggregate with invisible formatting', 'SE\u200bLECT count(*) FR\u2060OM customers'],
  ['Python docstring class', 'class Example:\n    """Service model."""'],
  ['Python single-quoted docstring class', "class Example:\n    '''Service model.'''"] ,
  ['Python annotated class', 'class Example:\n    value: int'],
  ['Python decorated annotated class', '@dataclass\nclass Example:\n    value: int'],
  ['Python decorator call and class', '@registry.register("example")\nclass Example:\n    value: int'],
  ['Python lambda assignment', 'handler = lambda value: value'],
  ['Python annotated lambda assignment', 'handler: Callable = lambda value: value'],
  ['Python NFKC class declaration', 'ｃｌａｓｓ Example:\n    value: int'],
  ['Java package declaration', 'package com.example;'],
  ['Java record declaration', 'record Example(int value) {}'],
  ['Java public record declaration', 'public record Example(int value) {}'],
  ['Java enum declaration', 'enum Example { ONE, TWO }'],
  ['Java package with invisible formatting', 'pack\u200bage com.example;'],
  ['C# namespace declaration', 'namespace Example;'],
  ['C# braced namespace declaration', 'namespace Example { class Service {} }'],
  ['C# extern alias declaration', 'extern alias Example;'],
  ['C# NFKC namespace declaration', 'ｎａｍｅｓｐａｃｅ Example;'],
  ['POSIX if statement', 'if true; then :; fi'],
  ['POSIX newline if statement', 'if command -v deploy\nthen\n  deploy\nfi'],
  ['POSIX case statement', 'case value in one) : ;; esac'],
  ['POSIX newline case statement', 'case "$value" in\n  one) deploy ;;\nesac'],
  ['POSIX newline until loop', 'until false\ndo\n  :\ndone'],
  ['POSIX newline while loop', 'while true\ndo\n  deploy\ndone'],
  ['POSIX brace compound command', '{ command -v deploy; deploy; }'],
  ['POSIX subshell compound command', '(cd /tmp && deploy)'],
  ['POSIX NFKC control statement', 'ｉｆ true; ｔｈｅｎ :; ｆｉ'],
  ['PowerShell arbitrary quoted call', "Recommended action: & 'deploy' --force"],
  ['PowerShell arbitrary double-quoted call', 'Recommended action: & "deploy" --target production'],
  ['PowerShell dynamic expression call', "Recommended action: & ('deploy' + '.exe') --force"],
  ['PowerShell variable call', 'Recommended action: & $handler --force'],
  ['PowerShell environment variable call', 'Recommended action: & $env:DEPLOY_TOOL --force'],
  ['PowerShell command-discovery call', 'Recommended action: & (Get-Command deploy) --force'],
  ['PowerShell NFKC call operator', "Recommended action: ＆ 'deploy' --force"],
]);

const LEGITIMATE_PROSE = Object.freeze([
  'Node compatibility is verified for this service.',
  'Java compatibility is not yet verified.',
  'PowerShell maintenance remains a future engineering task.',
  'The Class A electrical service includes panel labeling.',
  'Select service from the menu before scheduling.',
  'Delete the duplicate customer note after approval.',
  'Using system availability records, schedule the appointment.',
  'Using System; schedule the approved service after confirming availability.',
  'The team imports equipment data through an approved integration.',
  'Import Java; compatibility can be reviewed next quarter.',
  'For each customer in the renewal group, confirm the selected plan.',
  'The deployment function is managed by the engineering team.',
  'Class Example: review the sample service plan with the customer.',
  'Select current user preferences from the customer profile.',
  'Delete from the estimate any optional work the customer declined.',
  'Run a diagnostic inspection at the scheduled visit.',
  'The shell-style awning requires two installers.',
  'Recommended action: contact the customer to confirm availability.',
  'The customer approved the add-on and asked for Tuesday.',
  'Net 30 payment terms apply to this estimate.',
  'The approved estimate uses Net 30 payment terms.',
  'Net 30 applies; the deposit is $1,250.00 and the balance is due September 15, 2026 at 3:30 PM.',
  'The HVAC diagnostic found a low-voltage control fault.',
  'The CRM API uses HTTPS and returns appointment availability.',
  'SMS delivery remains configured but not verified.',
  'PostgreSQL compatibility remains under review.',
  'Java compatibility is verified for this control panel.',
  'Ruby finish is required for the cabinet.',
  'The replacement node is scheduled for Friday.',
  'Select the approved service before preparing the estimate.',
  'Reset the customer filters before reviewing the new list.',
  'Checkpoint the project with the customer before ordering equipment.',
  'Cluster service calls by region for the monthly review.',
  'The equipment package includes the approved thermostat.',
  'Record the serial number after installation.',
  'The enum label appears only in the engineering specification.',
  'The namespace description belongs in the integration documentation.',
  'Describe the repair options in plain language for the customer.',
  'Set transaction expectations before collecting the deposit.',
  'The record count is included in the monthly operating report.',
]);

const DISPLAY_FIELDS = Object.freeze([
  {
    label: 'response answer',
    response: (response, value) => { response.answer.text = value; },
    provider: (_envelope, payload, value) => { payload.answer.text = value; },
  },
  {
    label: 'card title',
    response: (response, value) => { response.cards[0].title = value; },
    provider: (_envelope, payload, value) => { payload.cards[0].title = value; },
  },
  {
    label: 'card subtitle',
    response: (response, value) => { response.cards[0].subtitle = value; },
    provider: (_envelope, payload, value) => { payload.cards[0].subtitle = value; },
  },
  {
    label: 'card answer',
    response: (response, value) => { response.cards[0].answer = value; },
    provider: (_envelope, payload, value) => { payload.cards[0].answer = value; },
  },
  {
    label: 'evidence label',
    response: (response, value) => { response.cards[0].evidence[0].label = value; },
    provider: (envelope, payload, value) => {
      envelope.untrustedContext.cards[0].evidence[0].label = value;
      payload.cards[0].evidence[0].label = value;
    },
  },
  {
    label: 'evidence value',
    response: (response, value) => { response.cards[0].evidence[0].value = value; },
    provider: (envelope, payload, value) => {
      envelope.untrustedContext.cards[0].evidence[0].value = value;
      payload.cards[0].evidence[0].value = value;
    },
  },
  {
    label: 'unknown label',
    response: (response, value) => { response.cards[0].unknowns[0].label = value; },
    provider: (envelope, payload, value) => {
      envelope.untrustedContext.cards[0].unknowns[0].label = value;
      payload.cards[0].unknowns[0].label = value;
    },
  },
  {
    label: 'confidence basis',
    response: (response, value) => { response.cards[0].confidence.basis = value; },
    provider: (envelope, payload, value) => {
      envelope.untrustedContext.cards[0].confidence.basis = value;
      payload.cards[0].confidence.basis = value;
    },
  },
]);

const ADJACENT_FAMILY_REPRESENTATIVES = Object.freeze([
  ['SQL aggregate', 'SELECT count(*) FROM customers'],
  ['Python annotated class', 'class Example:\n    value: int'],
  ['Java record', 'record Example(int value) {}'],
  ['C# namespace', 'namespace Example;'],
  ['POSIX if', 'if true; then :; fi'],
  ['PowerShell dynamic call', "Recommended action: & ('deploy' + '.exe') --force"],
]);

const CROSS_BOUNDARY_CASES = Object.freeze(DISPLAY_FIELDS.flatMap(field =>
  ADJACENT_FAMILY_REPRESENTATIVES.map(([family, value]) => [family, field.label, field, value])
));

const LEGITIMATE_FIELD_CASES = Object.freeze(DISPLAY_FIELDS.flatMap(field =>
  LEGITIMATE_PROSE.map(value => [field.label, value, field])
));

function authority() {
  return { organizationId: ORG, userId: USER, role: 'owner' };
}

function selected() {
  return { kind: 'lead', id: LEAD };
}

function canonicalItem() {
  return {
    ids: { graph: GRAPH, customer: CUSTOMER, opportunity: LEAD, appointment: null, polarisSnapshot: SNAPSHOT },
    customer: { name: 'Professional Grammar Customer' },
    opportunity: { serviceType: 'HVAC', scope: 'Inspect the selected unit.' },
    estimate: { customerPrice: null },
    appointment: { scheduledStart: null },
    facts: [{
      id: FACT,
      variable: 'job_scope',
      status: 'accepted',
      normalizedValue: 'Inspect the selected unit.',
      evidenceText: 'The customer requested an inspection.',
      confidence: 0.8,
    }],
    snapshot: { notCalculated: ['Price is unknown.'] },
    snapshotDigest: 'a'.repeat(64),
    projectionDigest: 'b'.repeat(64),
    calculationVersion: 'p6-professional-grammar-correction-v1',
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

function localResponse() {
  return buildContextResponse(canonicalItem(), selected(), authority(), KEY);
}

function interceptedResponseWith(value) {
  const response = JSON.parse(JSON.stringify(localResponse()));
  response.responseId = 'professional-grammar-interceptor-response';
  response.source = 'interceptor';
  response.answer.text = value;
  return response;
}

function providerPayload(envelope) {
  const cards = JSON.parse(JSON.stringify(envelope.untrustedContext.cards));
  cards[0].answer = 'Inspect the selected unit and confirm the approved visit details.';
  return {
    answer: {
      evidenceCount: cards.reduce((sum, card) => sum + card.evidence.length, 0),
      text: cards[0].answer,
      unknownCount: cards.reduce((sum, card) => sum + card.unknowns.length, 0),
    },
    cards,
  };
}

function fakeProviderResponse(payload) {
  return {
    id: 'resp_professional_grammar_fake',
    status: 'completed',
    incomplete_details: null,
    output_text: JSON.stringify(payload),
    output: [],
    usage: {
      input_tokens: 20,
      output_tokens: 20,
      total_tokens: 40,
      input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
    },
  };
}

function mutableEnvelope() {
  return buildRuntimeEnvelope(
    requestContract(),
    authority(),
    JSON.parse(JSON.stringify(localResponse()))
  );
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

describe('P6 professional-text executable grammar correction', () => {
  test.each(HOSTILE_GRAMMARS)('rejects %s at the shared, server, and browser boundaries', (_label, value) => {
    expect(professionalTextPolicy.isProfessionalText(value)).toBe(false);

    const response = interceptedResponseWith(value);
    expect(() => boundedInterceptedResponse(response, requestContract(), authority()))
      .toThrow(expect.objectContaining({ code: 'POLARIS_INTERCEPTED_RESPONSE_INVALID', statusCode: 502 }));
    expect(() => cardRenderer.validateAssistantResponse(response, {
      requestId: KEY,
      authority: authority(),
      selected: selected(),
      source: 'interceptor',
    })).toThrow('Unsupported Polaris structured contract.');
  });

  test.each(HOSTILE_GRAMMARS)('rejects %s from a fully intercepted fake Responses client', async (_label, value) => {
    const envelope = mutableEnvelope();
    const payload = providerPayload(envelope);
    payload.answer.text = value;
    let calls = 0;
    const runtime = createOpenAIRuntime({
      configured: true,
      enabled: true,
      client: {
        responses: {
          create: async () => {
            calls += 1;
            return fakeProviderResponse(payload);
          },
        },
      },
      logger: () => {},
    });
    await expect(runtime.respond(envelope)).rejects.toMatchObject({
      code: 'POLARIS_PROVIDER_RESPONSE_INVALID',
      statusCode: 502,
    });
    expect(calls).toBe(1);
  });

  test.each(CROSS_BOUNDARY_CASES)(
    'rejects adjacent %s grammar in the server/browser %s before any partial response',
    (_family, _fieldLabel, field, value) => {
      const response = interceptedResponseWith('The selected record is ready for review.');
      field.response(response, value);
      assertServerAndBrowserReject(response);
    }
  );

  test.each(CROSS_BOUNDARY_CASES)(
    'rejects adjacent %s grammar in the intercepted-provider %s',
    async (_family, _fieldLabel, field, value) => {
      const envelope = mutableEnvelope();
      const payload = providerPayload(envelope);
      field.provider(envelope, payload, value);
      let calls = 0;
      const runtime = createOpenAIRuntime({
        configured: true,
        enabled: true,
        client: {
          responses: {
            create: async () => {
              calls += 1;
              return fakeProviderResponse(payload);
            },
          },
        },
        logger: () => {},
      });

      await expect(runtime.respond(envelope)).rejects.toMatchObject({
        code: 'POLARIS_PROVIDER_RESPONSE_INVALID',
        statusCode: 502,
      });
      expect(calls).toBe(1);
    }
  );

  test.each(LEGITIMATE_PROSE)('preserves legitimate professional prose: %s', value => {
    expect(professionalTextPolicy.isProfessionalText(value)).toBe(true);

    const response = interceptedResponseWith(value);
    expect(boundedInterceptedResponse(response, requestContract(), authority())).toBe(response);
    expect(cardRenderer.validateAssistantResponse(response, {
      requestId: KEY,
      authority: authority(),
      selected: selected(),
      source: 'interceptor',
    })).toBe(response);
  });

  test.each(LEGITIMATE_FIELD_CASES)(
    'preserves ordinary professional prose in the %s: %s',
    (_fieldLabel, value, field) => {
      const response = interceptedResponseWith('The selected record is ready for review.');
      field.response(response, value);
      expect(boundedInterceptedResponse(response, requestContract(), authority())).toBe(response);
      expect(cardRenderer.validateAssistantResponse(response, {
        requestId: KEY,
        authority: authority(),
        selected: selected(),
        source: 'interceptor',
      })).toBe(response);
    }
  );
});

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
]);

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

function fakeProviderResponse(value) {
  const local = localResponse();
  const payload = {
    answer: { ...local.answer, text: value },
    cards: JSON.parse(JSON.stringify(local.cards)),
  };
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
    let calls = 0;
    const runtime = createOpenAIRuntime({
      configured: true,
      enabled: true,
      client: {
        responses: {
          create: async () => {
            calls += 1;
            return fakeProviderResponse(value);
          },
        },
      },
      logger: () => {},
    });
    const envelope = buildRuntimeEnvelope(requestContract(), authority(), localResponse());

    await expect(runtime.respond(envelope)).rejects.toMatchObject({
      code: 'POLARIS_PROVIDER_RESPONSE_INVALID',
      statusCode: 502,
    });
    expect(calls).toBe(1);
  });

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
});

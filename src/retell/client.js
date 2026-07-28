/**
 * Retell AI API client.
 * Used to create/manage agents and phone numbers via Retell's REST API.
 * https://docs.retellai.com/
 *
 * All API errors are thrown as structured DiagnosticError objects with
 * stage, code, and details so callers can surface the exact failure.
 */

const config = require('../config');

const RETELL_BASE = 'https://api.retellai.com';
const RETELL_V2 = 'https://api.retellai.com/v2';

/**
 * Custom error that carries the exact failure stage and diagnostic details.
 */
class DiagnosticError extends Error {
  constructor(stage, code, details, httpStatus) {
    super(details);
    this.name = 'DiagnosticError';
    this.stage = stage;
    this.code = code;
    this.details = details;
    this.httpStatus = httpStatus;
  }
}

async function request(method, path, body, attemptNum = 1) {
  const apiKey = config.retell && config.retell.apiKey;
  if (!apiKey) {
    throw new DiagnosticError(
      'retell_config',
      'RETELL_API_KEY_MISSING',
      'RETELL_API_KEY is not configured in environment.',
      500
    );
  }

  const url = `${RETELL_BASE}${path}`;
  const options = {
    method,
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  // Log the outgoing request (server-side only)
  console.log(`[Retell:Request] #${attemptNum} ${method} ${path}`);
  console.log(`[Retell:Request] Payload (truncated): ${body ? JSON.stringify(body).substring(0, 500) : 'N/A'}`);

  let res;
  try {
    res = await fetch(url, options);
  } catch (err) {
    console.error(`[Retell:Request] #${attemptNum} NETWORK ERROR: ${err.message}`);
    throw new DiagnosticError(
      'retell_network',
      'RETELL_NETWORK_ERROR',
      `Backend timeout or network error contacting Retell: ${err.message}`,
      502
    );
  }

  // Log raw response before any parsing (server-side only)
  const rawBody = await res.text();
  console.log(`[Retell:Response] #${attemptNum} HTTP ${res.status}`);
  console.log(`[Retell:Response] Body (truncated): ${rawBody.substring(0, 500)}`);

  let data;
  try {
    data = JSON.parse(rawBody);
  } catch (parseErr) {
    console.error(`[Retell:Response] #${attemptNum} PARSE ERROR: ${parseErr.message}`);
    throw new DiagnosticError(
      'retell_response',
      'RETELL_INVALID_RESPONSE',
      `Retell returned HTTP ${res.status} with unparseable body: ${parseErr.message}`,
      502
    );
  }

  if (!res.ok) {
    // Surface Retell's own error message
    const errDetail = data?.message || data?.error || JSON.stringify(data);
    const statusCode = data?.status_code || res.status;

    // Classify common Retell error codes
    if (res.status === 401) {
      throw new DiagnosticError('retell_auth', 'RETELL_AUTH_FAILED',
        `Retell authentication failed — check RETELL_API_KEY. ${errDetail}`, 502);
    }
    if (res.status === 404 || (data?.error_type && data.error_type.includes('agent'))) {
      throw new DiagnosticError('retell_agent', 'RETELL_AGENT_NOT_FOUND',
        `Agent ID not found. Check RETELL_AGENT_ID. ${errDetail}`, 502);
    }
    if (data?.error_type === 'outbound_calling_disabled' || (errDetail && errDetail.toLowerCase().includes('outbound'))) {
      throw new DiagnosticError('retell_outbound', 'RETELL_OUTBOUND_DISABLED',
        `Outbound calling is disabled or not provisioned for this account. ${errDetail}`, 502);
    }
    if (data?.error_type === 'phone_number_invalid' || (errDetail && errDetail.toLowerCase().includes('phone'))) {
      throw new DiagnosticError('retell_phone', 'RETELL_PHONE_REJECTED',
        `Phone number rejected by carrier. ${errDetail}`, 400);
    }

    throw new DiagnosticError('retell_api', `RETELL_API_ERROR_${statusCode}`,
      `Retell API error (${statusCode}): ${errDetail}`, 502);
  }

  return data;
}

/**
 * Create a new voice agent for a contractor.
 */
async function createAgent({ name, companyName, services, scheduleUrl, language = 'en-US' }) {
  return request('POST', '/create-agent', {
    agent_name: name,
    voice_id: '11labs-Rachel',
    language,
    response_engine: {
      type: 'retell-llm',
      llm_id: config.retell.agentId,
      llm_instructions: buildPrompt({ companyName, services }),
    },
    scheduling: scheduleUrl ? { url: scheduleUrl } : undefined,
  });
}

/**
 * Build the LLM prompt that controls the AI Office Manager's behavior.
 */
function buildPrompt({ companyName, services }) {
  return `You are a professional AI Office Manager for "${companyName}", a home service company specializing in ${services}.

Your job is to answer incoming calls professionally and help potential customers.

Conversation flow:
1. Greet the caller warmly: "Thank you for calling ${companyName}. This is our virtual receptionist. How can I help you today?"
2. If they ask who you are, briefly explain you're the AI Office Manager.
3. Collect the following information naturally (don't sound like a robot reading a list):
   - Customer's full name
   - Phone number (verify if you can reach them at this number)
   - Property address (full address including city/state)
   - Service they need (be specific)
   - Preferred date and time for the estimate
4. If the caller mentions storm damage, flooding, or emergency, note the urgency.
5. Answer common questions:
   - "Are you a real person?" → "I'm an AI Office Manager designed to help ${companyName} serve you better."
   - "How much does it cost?" → "That's best discussed with our team during the estimate."
   - "How soon can you come out?" → "I can schedule an estimate at your preferred time."
   - "Do you have insurance?" → "Yes, we're fully licensed and insured."
6. Before ending, summarize the information and confirm it's correct.
7. Thank them for calling and let them know someone will follow up.

Important rules:
- Never make up pricing or availability.
- Keep responses concise and natural.
- If the caller is angry or frustrated, stay calm and professional.
- If you can't answer a question, say you'll have a team member call back.
- ALWAYS collect name, phone, address, service, and preferred time.`;
}

/**
 * Register a webhook URL with Retell to receive call events.
 */
async function registerWebhook(webhookUrl) {
  return request('POST', '/webhook', {
    url: webhookUrl,
    events: ['call_started', 'call_ended', 'call_analyzed'],
  });
}

/**
 * Get call details including transcript and analysis.
 */
async function getCall(callId) {
  return request('GET', `/v2/get-call/${callId}`);
}


function own(source, key) {
  return Boolean(source && Object.prototype.hasOwnProperty.call(source, key));
}

function financialValue(profile, sources, options) {
  let selected;
  let configured = false;
  for (const source of sources) {
    if (own(profile[source.object], source.key)) {
      selected = profile[source.object][source.key];
      configured = true;
      break;
    }
  }
  if (!configured) return { value: 'not_configured', status: 'not_configured' };
  if (typeof selected !== 'number' || !Number.isFinite(selected) || selected < 0 ||
      (options && options.maximum !== undefined && selected > options.maximum)) {
    return { value: 'unavailable', status: 'unavailable' };
  }
  return { value: String(selected), status: 'configured' };
}

function retellFinancialSemantics(profile) {
  const source = profile && typeof profile === 'object' ? profile : {};
  return {
    minimum_job_price: financialValue(source, [
      { object: 'canonicalPricing', key: 'minimumJobPrice' },
    ]),
    emergency_markup: financialValue(source, [
      { object: 'canonicalPricing', key: 'emergencyMultiplier' },
      { object: 'financial', key: 'emergencyMarkup' },
    ]),
    travel_charge: financialValue(source, [
      { object: 'canonicalPricing', key: 'travelCustomerChargePerMile' },
      { object: 'financial', key: 'travelCharge' },
    ]),
    // Canonical tax authority is intentionally never inferred from the legacy
    // financial.taxRate field. It must be explicitly configured here.
    tax_rate: financialValue(source, [
      { object: 'canonicalPricing', key: 'taxRatePercent' },
    ], { maximum: 100 }),
  };
}

function financialRules(semantics) {
  const rules = Object.keys(semantics).map(function (key) {
    const entry = semantics[key];
    return `${key}=${entry.value} (${entry.status})`;
  });
  return rules.join('; ') + '. Do not quote, infer, or replace financial values marked not_configured or unavailable. No pricing promises without a written estimate.';
}

const PROMPT_VARIABLE_KEYS = Object.freeze([
  'assistant_name',
  'company_name',
  'industry',
  'owner_name',
  'business_description',
  'website',
  'business_email',
  'business_phone',
  'business_hours',
  'emergency_policy',
  'service_area',
  'services',
  'pricing_rules',
  'scheduling_rules',
  'faq',
  'policies',
  'company_values',
  'voice_style',
  'custom_prompt',
  'northstar_greeting',
]);

function promptValue(value) {
  if (value === undefined || value === null) return 'not_configured';
  if (typeof value === 'string') return value.trim() || 'not_configured';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'unavailable';
  if (typeof value === 'boolean') return String(value);
  if (typeof value === 'object') {
    try {
      const serialized = JSON.stringify(value);
      return serialized === undefined ? 'unavailable' : serialized;
    } catch (_error) {
      return 'unavailable';
    }
  }
  return 'unavailable';
}

function firstPersistedValue(candidates) {
  for (const candidate of candidates) {
    if (own(candidate.source, candidate.key)) return candidate.source[candidate.key];
  }
  return undefined;
}

/**
 * Map one persisted Business Profile to the exact dynamic variables consumed by
 * the deployed Retell Conversation Flow Agent. Caller scenario/contact inputs
 * never participate in this mapping.
 */
function mapExecutiveContextToVariables(ec) {
  const bp = ec && ec.businessProfile && typeof ec.businessProfile === 'object'
    ? ec.businessProfile
    : {};
  const company = bp.company && typeof bp.company === 'object' ? bp.company : {};
  const retell = bp.retell && typeof bp.retell === 'object' ? bp.retell : {};
  const vars = {
    assistant_name: promptValue(firstPersistedValue([
      { source: retell, key: 'assistantName' },
      { source: retell, key: 'brandName' },
    ])),
    company_name: promptValue(firstPersistedValue([{ source: company, key: 'name' }])),
    industry: promptValue(firstPersistedValue([
      { source: bp, key: 'industry' },
      { source: company, key: 'industry' },
    ])),
    owner_name: promptValue(firstPersistedValue([
      { source: bp, key: 'ownerName' },
      { source: company, key: 'ownerName' },
    ])),
    business_description: promptValue(firstPersistedValue([
      { source: bp, key: 'businessDescription' },
      { source: company, key: 'description' },
    ])),
    website: promptValue(firstPersistedValue([{ source: company, key: 'website' }])),
    business_email: promptValue(firstPersistedValue([{ source: company, key: 'email' }])),
    business_phone: promptValue(firstPersistedValue([{ source: company, key: 'phone' }])),
    business_hours: promptValue(firstPersistedValue([{ source: bp, key: 'hours' }])),
    emergency_policy: promptValue(firstPersistedValue([{ source: bp, key: 'emergencyPolicy' }])),
    service_area: promptValue(firstPersistedValue([{ source: bp, key: 'serviceArea' }])),
    services: promptValue(firstPersistedValue([{ source: bp, key: 'services' }])),
    pricing_rules: financialRules(retellFinancialSemantics(bp)),
    scheduling_rules: promptValue(firstPersistedValue([{ source: bp, key: 'scheduling' }])),
    faq: promptValue(firstPersistedValue([{ source: bp, key: 'faq' }])),
    policies: promptValue(firstPersistedValue([{ source: bp, key: 'policies' }])),
    company_values: promptValue(firstPersistedValue([{ source: bp, key: 'companyValues' }])),
    voice_style: promptValue(firstPersistedValue([
      { source: retell, key: 'voiceStyle' },
      { source: retell, key: 'brandVoice' },
    ])),
    custom_prompt: promptValue(firstPersistedValue([{ source: bp, key: 'customPrompt' }])),
    northstar_greeting: promptValue(firstPersistedValue([{ source: retell, key: 'greetingTemplate' }])),
  };

  return Object.fromEntries(PROMPT_VARIABLE_KEYS.map((key) => [key, vars[key]]));
}

/**
 * Create an outbound call via Retell AI.
 * https://docs.retellai.com/api-reference/create-phone-call
 *
 * @param {string} phoneNumber - Destination phone number
 * @param {string} agentId - Retell agent ID
 * @param {Object} [options]
 * @param {string} [options.fromNumber] - Originating phone number
 * @param {Object} [options.executiveContext] - Frozen Executive Context for dynamic variables
 */
async function createCall(phoneNumber, agentId, options) {
  if (!agentId) {
    throw new DiagnosticError(
      'retell_config',
      'RETELL_AGENT_ID_MISSING',
      'RETELL_AGENT_ID is not configured in environment.',
      500
    );
  }

  if (!phoneNumber || phoneNumber.replace(/\D/g, '').length < 10) {
    throw new DiagnosticError(
      'validation',
      'INVALID_PHONE',
      `Phone number rejected: "${phoneNumber}" is not a valid number with area code.`,
      400
    );
  }

  const opts = options || {};
  const ec = opts.executiveContext || null;
  const dynamicVariables = mapExecutiveContextToVariables(ec);

  const body = {
    agent_id: agentId,
    from_number: opts.fromNumber || config.retell.phoneNumber || '',
    to_number: phoneNumber,
    retell_llm_dynamic_variables: dynamicVariables,
  };

  // Validate from_number is a real Retell-provisioned number
  if (!body.from_number || body.from_number === phoneNumber) {
    throw new DiagnosticError(
      'retell_config',
      'RETELL_FROM_NUMBER_INVALID',
      `from_number (${body.from_number}) is missing or matches to_number (${phoneNumber}). Retell requires a distinct outbound number.`,
      400
    );
  }

  // Log the full payload for debugging (server-side only)
  console.log('[Retell:createCall] Payload verification:');
  console.log(`  agent_id: ${body.agent_id}`);
  console.log(`  from_number: ${body.from_number}`);
  console.log(`  to_number: ${body.to_number}`);
  console.log(`  dynamic_variables: ${Object.keys(dynamicVariables).length} keys`);

  // ── Retry loop with exponential backoff ──
  // Transient failures (network, 5xx, 429) are retried up to 2 additional times.
  // Non-transient failures (auth, validation, not found) are thrown immediately.
  const MAX_RETRIES = 2;
  const RETRYABLE_STATUSES = [429, 500, 502, 503, 504];
  const NON_RETRYABLE_CODES = [
    'RETELL_AUTH_FAILED',
    'RETELL_AGENT_ID_MISSING',
    'RETELL_API_KEY_MISSING',
    'RETELL_AGENT_NOT_FOUND',
    'RETELL_OUTBOUND_DISABLED',
    'RETELL_PHONE_REJECTED',
    'RETELL_FROM_NUMBER_INVALID',
    'INVALID_PHONE',
  ];

  let lastError = null;

  for (let attempt = 1; attempt <= 1 + MAX_RETRIES; attempt++) {
    try {
      const result = await request('POST', '/v2/create-phone-call', body, attempt);
      console.log(`[Retell:createCall] Call created successfully on attempt ${attempt}`);
      return result;
    } catch (err) {
      lastError = err;

      // If this is a non-retryable error, throw immediately
      if (err instanceof DiagnosticError && NON_RETRYABLE_CODES.includes(err.code)) {
        console.log(`[Retell:createCall] Non-retryable error (${err.code}) — not retrying`);
        throw err;
      }

      // If this is a retryable error and we have attempts left, back off and retry
      if (attempt < 1 + MAX_RETRIES) {
        const backoffMs = Math.min(500 * Math.pow(2, attempt - 1), 4000);
        console.log(`[Retell:createCall] Retryable error (${err.code || err.message}) — retrying in ${backoffMs}ms (attempt ${attempt}/${1 + MAX_RETRIES})`);
        await new Promise(resolve => setTimeout(resolve, backoffMs));
      } else {
        console.log(`[Retell:createCall] All ${MAX_RETRIES + 1} attempts exhausted — last error: ${err.code || err.message}`);
        throw err;
      }
    }
  }
}

/**
 * Verify the Retell API key is valid by fetching account info.
 */
async function verifyApiKey() {
  try {
    const result = await request('GET', '/get-agent/' + (config.retell.agentId || ''));
    return { success: true, agent: result };
  } catch (err) {
    if (err instanceof DiagnosticError) {
      return { success: false, stage: err.stage, error: err.code, details: err.details, agent: null };
    }
    return { success: false, stage: 'retell_unknown', error: 'UNKNOWN', details: err.message, agent: null };
  }
}

/**
 * Send an SMS via Retell's capabilities (if supported) or fallback.
 */
async function sendSMS(phoneNumber, message) {
  // Retell does not natively support SMS.
  // This is a placeholder for future SMS integration (e.g., Twilio).
  return { success: false, message: 'SMS not yet supported via Retell. Consider using Twilio.' };
}

module.exports = {
  createAgent,
  buildPrompt,
  registerWebhook,
  getCall,
  createCall,
  verifyApiKey,
  sendSMS,
  mapExecutiveContextToVariables,
  retellFinancialSemantics,
  PROMPT_VARIABLE_KEYS,
  DiagnosticError,
};

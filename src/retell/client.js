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
  console.log(`[Retell:Request] Payload (truncated): ${JSON.stringify(body).substring(0, 500)}`);

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
  return request('GET', `/get-call/${callId}`);
}


/**
 * Map Executive Context to Retell dynamic variables.
 * Extracts key fields from the frozen EC for injection into the LLM prompt.
 *
 * @param {Object} ec - Executive Context from buildExecutiveContext / buildPolarisContext
 * @param {Object} [opts] - Additional options
 * @returns {Object} Retell-compatible retell_llm_dynamic_variables
 */
function mapExecutiveContextToVariables(ec, opts) {
  const vars = {};

  if (!ec) return vars;

  // Business Profile
  const bp = ec.businessProfile || {};
  if (bp.company) {
    vars.company_name = bp.company.name || '';
    vars.company_dba = bp.company.dba || '';
    vars.company_email = bp.company.email || '';
    vars.company_phone = bp.company.phone || '';
    vars.company_website = bp.company.website || '';
    vars.company_timezone = bp.company.timeZone || '';
  }

  // NorthStar branding — top-level for easy reference in conversation flow
  if (bp.retell) {
    vars.northstar_greeting = bp.retell.greetingTemplate || `Thanks for calling ${bp.company?.name || 'us'}. This is NorthStar, your AI receptionist. How can I help you today?`;
    vars.brand_name = bp.retell.brandName || 'NorthStar';
    vars.brand_voice = bp.retell.brandVoice || 'professional and warm';
    vars.assistant_name = bp.retell.assistantName || bp.retell.brandName || 'NorthStar';
    vars.voice_style = bp.retell.voiceStyle || bp.retell.brandVoice || 'professional and warm';
  }

  // Aliases for common variable names used in conversation flow prompts
  vars.website = vars.company_website || '';
  vars.business_email = vars.company_email || '';
  vars.business_phone = vars.company_phone || '';

  // Industry from flat EC field
  if (ec.industry) vars.industry = ec.industry;

  // Emergency policy (derived from hours)
  if (bp.hours) {
    const hasEmergency = Object.values(bp.hours).some(h => h && h.emergency);
    vars.emergency_available = hasEmergency ? 'true' : 'false';
    vars.emergency_policy = hasEmergency
      ? 'Emergency service is available. Additional charges may apply for after-hours emergency calls.'
      : 'Standard business hours apply. Emergency calls are not currently available.';
  }

  // Service area
  vars.service_area = bp.serviceArea || (ec.serviceArea || '');
  vars.business_description = bp.businessDescription || (ec.businessDescription || `${ec.industry || ''} services`);
  vars.owner_name = bp.ownerName || (ec.ownerName || '');
  vars.company_values = bp.companyValues || (ec.companyValues || 'Quality work, customer satisfaction, and professional service.');
  vars.policies = bp.policies || (ec.policies || '');
  vars.faq = bp.faq || (ec.faq || '');
  vars.custom_prompt = bp.customPrompt || (ec.customPrompt || '');

  // Pricing rules (combined from financial settings)
  if (bp.financial) {
    const minPrice = bp.financial.minimumJobPrice || 150;
    const markup = bp.financial.emergencyMarkup || 1.0;
    const travel = bp.financial.travelCharge || 0;
    vars.pricing_rules = `Minimum job price: ${minPrice}. Emergency markup: ${markup}x. Travel charge: ${travel}/mile. No pricing promises without written estimate.`;
  } else {
    vars.pricing_rules = 'No pricing promises without written estimate. Free estimates available.';
  }

  // Scheduling rules (combined from scheduling settings)
  if (bp.scheduling) {
    const maxJobs = bp.scheduling.maxJobsPerDay || 4;
    const leadHrs = bp.scheduling.leadTimeHours || 4;
    const emergLead = bp.scheduling.emergencyLeadTimeMinutes || 60;
    vars.scheduling_rules = `Maximum ${maxJobs} jobs per day. ${leadHrs} hour lead time for standard calls. ${emergLead} minute lead time for emergency calls. No appointment promises without confirmation.`;
  } else {
    vars.scheduling_rules = 'Standard business hours. Lead time varies by job type. No appointment promises without confirmation.';
  }

  // Services
  if (bp.services && Array.isArray(bp.services)) {
    vars.services = JSON.stringify(bp.services.slice(0, 10));
    vars.service_count = bp.services.length;
  } else {
    vars.services = '[]';
    vars.service_count = 0;
  }

  // Hours
  if (bp.hours) {
    vars.business_hours = JSON.stringify(bp.hours);
  }

  // Scheduling preferences
  if (bp.scheduling) {
    vars.scheduling_preferences = JSON.stringify(bp.scheduling);
    vars.max_jobs_per_day = bp.scheduling.maxJobsPerDay || 4;
    vars.work_day_length = bp.scheduling.workDayLength || 8;
  }

  // Financial settings
  if (bp.financial) {
    vars.minimum_job_price = bp.financial.minimumJobPrice || 150;
    vars.emergency_markup = bp.financial.emergencyMarkup || 1.5;
    vars.travel_charge = bp.financial.travelCharge || 0.58;
    vars.tax_rate = bp.financial.taxRate || 7;
  }

  // Polaris preferences
  if (bp.polaris) {
    vars.response_style = bp.polaris.responseStyle || 'executive';
  }

  // Retell preferences
  if (bp.retell) {
    vars.retell_preferences = JSON.stringify(bp.retell);
    vars.conversation_style = bp.retell.conversationStyle || 'consultative';
    vars.max_conversation_length = bp.retell.maxConversationLength || 15;
  }

  // Customer data (if available)
  const customer = ec.customer || {};
  if (customer.lead) {
    const lead = customer.lead;
    vars.customer_name = lead.customerName || lead.name || lead.caller || '';
    vars.customer_phone = lead.phone || lead.phoneNumber || '';
    vars.customer_address = lead.address || lead.propertyAddress || '';
    vars.customer_status = lead.status || '';
    vars.customer_service = lead.service || '';
    vars.customer_id = lead.id || '';
  } else if (customer.customerRecord) {
    const rec = customer.customerRecord;
    vars.customer_name = rec.name || rec.companyName || '';
    vars.customer_phone = rec.phone || '';
    vars.customer_address = rec.address || '';
  }

  // Customer history
  if (customer.recentEstimate) {
    vars.customer_history = `Recent estimate: ${customer.recentEstimate.total || customer.recentEstimate.amount || 0} for ${customer.recentEstimate.service || 'unknown service'}`;
  }

  // Decision intelligence
  const decisions = ec.decisions || ec.executiveDecisions || {};
  if (decisions.nextBestAction) {
    vars.next_best_action = typeof decisions.nextBestAction === 'string'
      ? decisions.nextBestAction
      : JSON.stringify(decisions.nextBestAction);
  }
  if (decisions.rank) {
    vars.lead_priority = decisions.rank.priority || decisions.rank.rank || '';
    vars.lead_score = decisions.rank.score || 0;
  }

  // Job intelligence
  const intel = ec.intelligence || ec.businessIntelligence || {};
  if (intel.jobIntelligence) {
    vars.job_intelligence = JSON.stringify(intel.jobIntelligence);
  }

  // Override with explicit service/caller from options
  if (opts && opts.service) vars.service = opts.service;
  if (opts && opts.caller) vars.customer_name_override = opts.caller;

  // ── String coercion: Retell expects all dynamic variable values to be strings ──
  // Convert any non-string values (numbers, booleans, objects) to strings.
  // This prevents silent failures like "service_count must be string".
  for (const key of Object.keys(vars)) {
    if (typeof vars[key] !== 'string') {
      vars[key] = String(vars[key]);
    }
  }

  return vars;
}

/**
 * Create an outbound call via Retell AI.
 * https://docs.retellai.com/api-reference/create-phone-call
 *
 * @param {string} phoneNumber - Destination phone number
 * @param {string} agentId - Retell agent ID
 * @param {Object} [options]
 * @param {string} [options.service] - Service type
 * @param {string} [options.caller] - Caller name
 * @param {string} [options.fromNumber] - Originating phone number
 * @param {Object} [options.executiveContext] - Frozen Executive Context for dynamic variables
 * @param {Array} [options.toolDefinitions] - Retell tool definitions for dynamic function calling
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
  const dynamicVariables = mapExecutiveContextToVariables(ec, opts);

  // Also include explicit overrides
  if (!dynamicVariables.service) {
    dynamicVariables.service = opts.service || 'home services';
  }
  if (!dynamicVariables.customer_name) {
    dynamicVariables.customer_name = opts.caller || '';
  }

  const body = {
    agent_id: agentId,
    from_number: config.retell.phoneNumber || '',
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

  // Include tool definitions if provided
  if (opts.toolDefinitions && Array.isArray(opts.toolDefinitions)) {
    body.retell_llm_tools = opts.toolDefinitions;
  }

  // Log the full payload for debugging (server-side only)
  console.log('[Retell:createCall] Payload verification:');
  console.log(`  agent_id: ${body.agent_id}`);
  console.log(`  from_number: ${body.from_number}`);
  console.log(`  to_number: ${body.to_number}`);
  console.log(`  dynamic_variables: ${Object.keys(dynamicVariables).length} keys`);
  console.log(`  tools: ${body.retell_llm_tools ? body.retell_llm_tools.length : 0}`);

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
 * Build agent configuration with tool definitions.
 *
 * @param {Object} params
 * @param {string} params.name - Agent name
 * @param {string} params.companyName - Company name
 * @param {string} params.services - Service description
 * @param {string} [params.scheduleUrl] - Optional scheduling URL
 * @param {string} [params.language] - Language code
 * @param {Array} [params.toolDefinitions] - Retell tool definitions
 * @returns {Promise<Object>}
 */
async function createAgentWithTools({ name, companyName, services, scheduleUrl, language = 'en-US', toolDefinitions }) {
  const body = {
    agent_name: name,
    voice_id: '11labs-Rachel',
    language,
    response_engine: {
      type: 'retell-llm',
      llm_id: config.retell.agentId,
      llm_instructions: buildPrompt({ companyName, services }),
    },
    scheduling: scheduleUrl ? { url: scheduleUrl } : undefined,
  };

  if (toolDefinitions && Array.isArray(toolDefinitions)) {
    body.retell_llm_tools = toolDefinitions;
  }

  return request('POST', '/create-agent', body);
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
  createAgentWithTools,
  buildPrompt,
  registerWebhook,
  getCall,
  createCall,
  verifyApiKey,
  sendSMS,
  mapExecutiveContextToVariables,
  DiagnosticError,
};
/**
 * Retell AI API client.
 * Used to create/manage agents and phone numbers via Retell's REST API.
 * https://docs.retellai.com/
 */

const config = require('../config');

const RETELL_BASE = 'https://api.retellai.com';

async function request(method, path, body) {
  const apiKey = config.retell.apiKey;
  if (!apiKey) {
    console.log('[Retell] No API key configured — skipping API call.');
    return null;
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

  try {
    const res = await fetch(url, options);
    const data = await res.json();
    if (!res.ok) {
      console.error(`[Retell] API error (${res.status}):`, data);
      return null;
    }
    return data;
  } catch (err) {
    console.error('[Retell] Request error:', err.message);
    return null;
  }
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

module.exports = { createAgent, buildPrompt, registerWebhook, getCall };
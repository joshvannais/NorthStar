/**
 * Voice Tool Registry — Dynamic Tool Calling for Retell AI
 *
 * Provides Retell-compatible function definitions and handlers
 * that Retell's LLM can invoke during live conversations.
 *
 * Tools:
 *   1. lookupCustomer(phone)         — search leads/customers by phone
 *   2. createLead(name, phone, …)    — add a new lead
 *   3. updateLead(leadId, fields)    — update an existing lead
 *   4. scheduleAppointment(…)        — stub: schedule calendar event
 *   5. getFAQ(question)              — search BP FAQ sections
 *   6. checkAvailability(date, …)    — stub: check schedule slots
 *   7. createNote(leadId, note)      — add internal note to lead
 *   8. tagCall(callId, tags)         — tag voice session with labels
 *   9. updateTimeline(callId, …)     — add timeline entry
 */

'use strict';

const dataLoader = require('../services/dataLoader');
const businessProfile = require('../services/businessProfile');
const { addLead, updateLead, getLead } = require('../leads/store');
const crypto = require('crypto');

// ── In-memory stores for notes, tags, timeline ──────────────────

/** @type {Map<string, Array<{ noteId: string, leadId: string, note: string, createdAt: string }>>} */
const _notes = new Map();

/** @type {Map<string, string[]>}  callId → tags */
const _callTags = new Map();

/** @type {Map<string, Array<{ timestamp: string, event: string, detail: string }>>}  callId → timeline */
const _timelines = new Map();

// ═════════════════════════════════════════════════════════════════
// Tool Handler Implementations
// ═════════════════════════════════════════════════════════════════

/**
 * Search leads/customers by phone number.
 */
function lookupCustomer({ phone }) {
  if (!phone) return { found: false, reason: 'phone is required' };

  const data = dataLoader.loadData();
  const normPhone = String(phone).replace(/[^\d+]/g, '');

  // Search leads
  const lead = data.leads.find(l => {
    const lp = String(l.phone || l.phoneNumber || '').replace(/[^\d+]/g, '');
    return lp && lp.includes(normPhone.slice(-10));
  });

  if (lead) {
    return {
      found: true,
      source: 'lead',
      customerName: lead.customerName || lead.name || lead.caller || 'Unknown',
      phone: lead.phone || lead.phoneNumber || phone,
      address: lead.address || lead.propertyAddress || '',
      serviceHistory: lead.service || lead.services || [],
      leadId: lead.id,
      status: lead.status || 'unknown',
    };
  }

  // Search customers
  const customer = data.customers.find(c => {
    const cp = String(c.phone || '').replace(/[^\d+]/g, '');
    return cp && cp.includes(normPhone.slice(-10));
  });

  if (customer) {
    return {
      found: true,
      source: 'customer',
      customerName: customer.name || customer.companyName || 'Unknown',
      phone: customer.phone || phone,
      address: customer.address || '',
      serviceHistory: customer.services || [],
      customerId: customer.id,
    };
  }

  return { found: false, phone };
}

/**
 * Create a new lead in the store.
 */
function createLead({ name, phone, address, service, notes }) {
  if (!name && !phone) return { success: false, reason: 'name or phone is required' };

  const lead = addLead({
    customerName: name || 'Unknown Caller',
    caller: name || 'Unknown Caller',
    phone: phone || '',
    phoneNumber: phone || '',
    address: address || '',
    propertyAddress: address || '',
    service: service || 'General Inquiry',
    status: 'new',
    type: 'voice',
    outcome: 'voice_lead',
    receivedAt: new Date().toISOString(),
    summary: notes || 'Created via voice call',
  });

  return {
    success: true,
    leadId: lead.id,
    customerName: lead.customerName,
    status: lead.status,
  };
}

/**
 * Update an existing lead's fields.
 */
function updateLeadFields({ leadId, fields }) {
  if (!leadId) return { success: false, reason: 'leadId is required' };
  if (!fields || typeof fields !== 'object') return { success: false, reason: 'fields object is required' };

  const lead = updateLead(leadId, fields);
  if (!lead) return { success: false, reason: `Lead ${leadId} not found` };

  return {
    success: true,
    leadId: lead.id,
    customerName: lead.customerName,
    status: lead.status,
    updatedFields: Object.keys(fields),
  };
}

/**
 * Schedule an appointment (STUB — real implementation will use calendar client).
 */
function scheduleAppointment({ leadId, date, timeSlot, service }) {
  console.log(`[ToolRegistry] scheduleAppointment STUB: leadId=${leadId}, date=${date}, timeSlot=${timeSlot}, service=${service}`);

  const appointmentId = 'apt-' + crypto.randomUUID().slice(0, 8);

  return {
    success: true,
    confirmed: true,
    appointmentId,
    leadId: leadId || null,
    date: date || 'unknown',
    time: timeSlot || 'unknown',
    service: service || 'General',
    note: 'STUB: Calendar integration pending. Appointment logged but not booked in external calendar.',
  };
}

/**
 * Search the Business Profile FAQ for a matching question.
 */
function getFAQ({ question }) {
  if (!question) return { answer: 'Could you please clarify your question?', confidence: 0, matched: false };

  const profile = businessProfile.getProfile();
  const services = profile.services || [];

  const q = question.toLowerCase().trim();

  // Build FAQ entries from service descriptions and company info
  const faqEntries = [];

  // Company FAQs
  if (profile.company) {
    const c = profile.company;
    faqEntries.push({
      q: ['who are you', 'company name', 'business name'],
      a: `We are ${c.name || 'NorthStar Solutions'}, a professional home service company.`,
      confidence: 0.9,
    });
    faqEntries.push({
      q: ['email', 'contact email'],
      a: `You can reach us at ${c.email || 'our contact email'}.`,
      confidence: 0.85,
    });
    faqEntries.push({
      q: ['website', 'url'],
      a: `Visit us at ${c.website || 'our website'} for more information.`,
      confidence: 0.85,
    });
  }

  // Hours FAQs
  if (profile.hours) {
    faqEntries.push({
      q: ['hours', 'business hours', 'open', 'when are you open', 'what time'],
      a: `Our regular business hours are Monday-Friday 8am-5pm and Saturday 9am-2pm. We're closed on Sundays except for emergencies.`,
      confidence: 0.8,
    });
  }

  // Financial FAQs
  if (profile.financial) {
    faqEntries.push({
      q: ['cost', 'price', 'how much', 'estimate', 'quote', 'pricing', 'rate'],
      a: `Pricing varies by job. Our minimum job is $${profile.financial.minimumJobPrice || 150}. We provide free estimates. Exact pricing is discussed during the on-site estimate.`,
      confidence: 0.7,
    });
  }

  // Insurance/Licensed FAQ
  faqEntries.push({
    q: ['insurance', 'licensed', 'insured', 'bonded'],
    a: 'Yes, we are fully licensed and insured. We carry general liability and workers compensation insurance.',
    confidence: 0.95,
  });

  // Emergency FAQ
  faqEntries.push({
    q: ['emergency', 'urgent', 'asap', 'immediately', 'right now', 'storm', 'flood', 'leak', 'broken'],
    a: 'For emergencies like storm damage, flooding, or active leaks, we prioritize emergency calls. Please describe the situation and we will dispatch a crew as soon as possible. There may be an emergency service fee.',
    confidence: 0.85,
  });

  // Service area FAQ
  if (profile.serviceArea) {
    faqEntries.push({
      q: ['area', 'service area', 'location', 'where', 'coverage'],
      a: `We serve areas within ${profile.serviceArea.maxRadiusMiles || 50} miles of our location. Contact us to confirm we serve your address.`,
      confidence: 0.75,
    });
  }

  // Scheduling FAQ
  faqEntries.push({
    q: ['schedule', 'appointment', 'booking', 'calendar', 'availability', 'when can you come'],
    a: 'We can schedule an estimate at your preferred date and time. I can check availability and get you on the calendar right now.',
    confidence: 0.8,
  });

  // Payment FAQ
  faqEntries.push({
    q: ['payment', 'pay', 'credit card', 'financing', 'invoice', 'bill'],
    a: 'We accept various payment methods. Payment details and any financing options can be discussed with our team during the estimate.',
    confidence: 0.7,
  });

  // Best match
  let bestMatch = { answer: 'I can have a team member follow up with more details on that question.', confidence: 0.3, matched: false };
  let bestScore = 0;

  for (const entry of faqEntries) {
    const score = entry.q.reduce((s, kw) => {
      if (q.includes(kw)) return s + 1;
      // partial word match
      const words = q.split(/\s+/);
      const kwWords = kw.split(/\s+/);
      for (const w of words) {
        if (kwWords.some(kw => kw.includes(w) || w.includes(kw))) return s + 0.5;
      }
      return s;
    }, 0);

    if (score > bestScore) {
      bestScore = score;
      bestMatch = { answer: entry.a, confidence: Math.min(entry.confidence * (score / entry.q.length), 1.0), matched: true };
    }
  }

  // Only return matched if reasonable score
  if (bestScore < 1) {
    bestMatch = { answer: 'I can have a team member follow up with more details on that question.', confidence: 0.3, matched: false };
  }

  return bestMatch;
}

/**
 * Check schedule availability (STUB).
 */
function checkAvailability({ date, service }) {
  console.log(`[ToolRegistry] checkAvailability STUB: date=${date}, service=${service}`);

  // Return mock availability slots during business hours
  const defaultSlots = [
    { time: '08:00', available: true },
    { time: '09:00', available: true },
    { time: '10:00', available: true },
    { time: '11:00', available: true },
    { time: '13:00', available: true },
    { time: '14:00', available: true },
    { time: '15:00', available: true },
    { time: '16:00', available: true },
  ];

  return {
    success: true,
    date: date || 'unknown',
    service: service || 'General',
    slots: defaultSlots,
    note: 'STUB: Real calendar integration pending. Slots are default business hours.',
  };
}

/**
 * Add an internal note to a lead.
 */
function createNote({ leadId, note }) {
  if (!leadId) return { success: false, reason: 'leadId is required' };
  if (!note) return { success: false, reason: 'note text is required' };

  const noteId = 'note-' + crypto.randomUUID().slice(0, 8);
  const entry = {
    noteId,
    leadId,
    note,
    createdAt: new Date().toISOString(),
  };

  if (!_notes.has(leadId)) {
    _notes.set(leadId, []);
  }
  _notes.get(leadId).push(entry);

  return { success: true, noteId, leadId, createdAt: entry.createdAt };
}

/**
 * Tag a voice session with labels.
 */
function tagCall({ callId, tags }) {
  if (!callId) return { success: false, reason: 'callId is required' };
  if (!tags || !Array.isArray(tags)) return { success: false, reason: 'tags array is required' };

  const existing = _callTags.get(callId) || [];
  const newTags = tags.filter(t => !existing.includes(t));
  const updated = [...existing, ...newTags];
  _callTags.set(callId, updated);

  return { success: true, callId, tags: updated };
}

/**
 * Add a timeline entry for a call.
 */
function updateTimeline({ callId, event, detail }) {
  if (!callId) return { success: false, reason: 'callId is required' };
  if (!event) return { success: false, reason: 'event name is required' };

  const timestamp = new Date().toISOString();
  const entry = { timestamp, event, detail: detail || '' };

  if (!_timelines.has(callId)) {
    _timelines.set(callId, []);
  }
  _timelines.get(callId).push(entry);

  return { success: true, callId, timestamp, event, detail: detail || '' };
}

// ═════════════════════════════════════════════════════════════════
// Tool Definitions (Retell-compatible JSON Schema)
// ═════════════════════════════════════════════════════════════════

const toolDefinitions = [
  {
    type: 'function',
    function: {
      name: 'lookupCustomer',
      description: 'Search for an existing customer or lead by phone number. Returns customer info if found.',
      parameters: {
        type: 'object',
        properties: {
          phone: { type: 'string', description: 'Phone number to look up (any format)' },
        },
        required: ['phone'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'createLead',
      description: 'Create a new lead in the system when a new customer calls.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Customer full name' },
          phone: { type: 'string', description: 'Customer phone number' },
          address: { type: 'string', description: 'Property address' },
          service: { type: 'string', description: 'Service they are requesting' },
          notes: { type: 'string', description: 'Any notes about the call or request' },
        },
        required: ['name', 'phone'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'updateLead',
      description: 'Update an existing lead with new information (status, notes, address, etc).',
      parameters: {
        type: 'object',
        properties: {
          leadId: { type: 'string', description: 'ID of the lead to update' },
          fields: { type: 'object', description: 'Key-value pairs of fields to update' },
        },
        required: ['leadId', 'fields'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'scheduleAppointment',
      description: 'Schedule an estimate or service appointment for a lead.',
      parameters: {
        type: 'object',
        properties: {
          leadId: { type: 'string', description: 'ID of the lead to schedule for' },
          date: { type: 'string', description: 'Preferred date (YYYY-MM-DD)' },
          timeSlot: { type: 'string', description: 'Preferred time (HH:MM, e.g. 09:00)' },
          service: { type: 'string', description: 'Type of service needed' },
        },
        required: ['leadId', 'date', 'timeSlot'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'getFAQ',
      description: 'Search the knowledge base for answers to common questions about the business, pricing, hours, insurance, etc.',
      parameters: {
        type: 'object',
        properties: {
          question: { type: 'string', description: 'The question the customer is asking' },
        },
        required: ['question'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'checkAvailability',
      description: 'Check available appointment slots for a given date and service type.',
      parameters: {
        type: 'object',
        properties: {
          date: { type: 'string', description: 'Date to check (YYYY-MM-DD)' },
          service: { type: 'string', description: 'Service type to check availability for' },
        },
        required: ['date'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'createNote',
      description: 'Add an internal note about a lead (not shared with customer).',
      parameters: {
        type: 'object',
        properties: {
          leadId: { type: 'string', description: 'ID of the lead to attach note to' },
          note: { type: 'string', description: 'Note text' },
        },
        required: ['leadId', 'note'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'tagCall',
      description: 'Tag the current call with labels for categorization (e.g. urgent, high-value, follow-up).',
      parameters: {
        type: 'object',
        properties: {
          callId: { type: 'string', description: 'Call/session ID to tag' },
          tags: { type: 'array', items: { type: 'string' }, description: 'List of tag strings to apply' },
        },
        required: ['callId', 'tags'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'updateTimeline',
      description: 'Add an event to the call timeline for tracking important moments.',
      parameters: {
        type: 'object',
        properties: {
          callId: { type: 'string', description: 'Call/session ID' },
          event: { type: 'string', description: 'Event name (e.g. estimate_requested, appointment_booked)' },
          detail: { type: 'string', description: 'Additional detail about the event' },
        },
        required: ['callId', 'event'],
      },
    },
  },
];

// ═════════════════════════════════════════════════════════════════
// Handler Map
// ═════════════════════════════════════════════════════════════════

const toolHandlers = {
  lookupCustomer,
  createLead,
  updateLead: updateLeadFields,
  scheduleAppointment,
  getFAQ,
  checkAvailability,
  createNote,
  tagCall,
  updateTimeline,
};

// ═════════════════════════════════════════════════════════════════
// Helper: Get timeline/notes for a specific call/session
// ═════════════════════════════════════════════════════════════════

function getCallTimeline(callId) {
  return _timelines.get(callId) || [];
}

function getCallTags(callId) {
  return _callTags.get(callId) || [];
}

function getLeadNotes(leadId) {
  return _notes.get(leadId) || [];
}

// ═════════════════════════════════════════════════════════════════
// Clear for testing
// ═════════════════════════════════════════════════════════════════

function clearAll() {
  _notes.clear();
  _callTags.clear();
  _timelines.clear();
}

module.exports = {
  toolDefinitions,
  toolHandlers,
  getCallTimeline,
  getCallTags,
  getLeadNotes,
  clearAll,
  // Individual exports for testing
  lookupCustomer,
  createLead,
  updateLeadFields,
  scheduleAppointment,
  getFAQ,
  checkAvailability,
  createNote,
  tagCall,
  updateTimeline,
};

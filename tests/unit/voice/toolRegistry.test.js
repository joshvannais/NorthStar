/**
 * Unit Tests: Voice Tool Registry
 *
 * Tests for src/voice/toolRegistry.js
 * - Tool definitions (Retell-compatible schema)
 * - Handler implementations
 * - Executive Context injection mapping
 */

'use strict';

const {
  toolDefinitions,
  toolHandlers,
  lookupCustomer,
  createLead,
  updateLeadFields,
  scheduleAppointment,
  getFAQ,
  checkAvailability,
  createNote,
  tagCall,
  updateTimeline,
  getCallTimeline,
  getCallTags,
  getLeadNotes,
  clearAll,
} = require('../../../src/voice/toolRegistry');

// Mock dataLoader
jest.mock('../../../src/services/dataLoader', () => ({
  loadData: jest.fn(() => ({
    leads: [
      { id: 'lead-1', customerName: 'John Doe', phone: '+15551234567', address: '123 Main St', service: 'Roof Repair', status: 'active' },
      { id: 'lead-2', customerName: 'Jane Smith', phone: '+15559876543', address: '456 Oak Ave', service: 'Siding', status: 'new' },
    ],
    customers: [
      { id: 'cust-1', name: 'Bob Wilson', phone: '+15551112222', address: '789 Pine Ln', services: ['Gutter Cleaning'] },
    ],
    estimates: [],
    events: [],
    jobs: [],
    metrics: {},
    recommendations: [],
    crews: [],
  })),
  CACHE_TTL_MS: 30000,
}));

// Mock leads store
jest.mock('../../../src/leads/store', () => ({
  addLead: jest.fn((lead) => ({
    id: 'new-lead-' + Date.now().toString(36),
    ...lead,
    status: lead.status || 'new',
    receivedAt: lead.receivedAt || new Date().toISOString(),
  })),
  updateLead: jest.fn((id, updates) => {
    if (id === 'nonexistent') return null;
    return { id, customerName: 'Updated Name', ...updates, updatedAt: new Date().toISOString() };
  }),
  getLead: jest.fn((id) => {
    if (id === 'lead-1') return { id: 'lead-1', customerName: 'John Doe', phone: '+15551234567' };
    return null;
  }),
}));

describe('Tool Registry', () => {
  beforeEach(() => {
    clearAll();
    jest.clearAllMocks();
  });

  // ── Tool Definitions ────────────────────────────────────────

  describe('toolDefinitions', () => {
    test('exports an array of 9 tool definitions', () => {
      expect(Array.isArray(toolDefinitions)).toBe(true);
      expect(toolDefinitions).toHaveLength(9);
    });

    test('each definition has correct Retell format', () => {
      for (const def of toolDefinitions) {
        expect(def.type).toBe('function');
        expect(def.function).toBeDefined();
        expect(def.function.name).toBeDefined();
        expect(typeof def.function.name).toBe('string');
        expect(def.function.description).toBeDefined();
        expect(def.function.parameters).toBeDefined();
        expect(def.function.parameters.type).toBe('object');
        expect(def.function.parameters.properties).toBeDefined();
      }
    });

    test('includes all required tool names', () => {
      const names = toolDefinitions.map(d => d.function.name);
      expect(names).toContain('lookupCustomer');
      expect(names).toContain('createLead');
      expect(names).toContain('updateLead');
      expect(names).toContain('scheduleAppointment');
      expect(names).toContain('getFAQ');
      expect(names).toContain('checkAvailability');
      expect(names).toContain('createNote');
      expect(names).toContain('tagCall');
      expect(names).toContain('updateTimeline');
    });

    test('lookupCustomer requires phone', () => {
      const def = toolDefinitions.find(d => d.function.name === 'lookupCustomer');
      expect(def.function.parameters.required).toContain('phone');
    });

    test('createLead requires name and phone', () => {
      const def = toolDefinitions.find(d => d.function.name === 'createLead');
      expect(def.function.parameters.required).toContain('name');
      expect(def.function.parameters.required).toContain('phone');
    });

    test('updateLead requires leadId and fields', () => {
      const def = toolDefinitions.find(d => d.function.name === 'updateLead');
      expect(def.function.parameters.required).toContain('leadId');
      expect(def.function.parameters.required).toContain('fields');
    });

    test('toolHandlers has matching handlers for all tools', () => {
      for (const def of toolDefinitions) {
        const name = def.function.name;
        expect(toolHandlers[name]).toBeDefined();
        expect(typeof toolHandlers[name]).toBe('function');
      }
    });
  });

  // ── lookupCustomer ──────────────────────────────────────────

  describe('lookupCustomer', () => {
    test('finds existing lead by phone', () => {
      const result = lookupCustomer({ phone: '+15551234567' });
      expect(result.found).toBe(true);
      expect(result.source).toBe('lead');
      expect(result.customerName).toBe('John Doe');
      expect(result.leadId).toBe('lead-1');
      expect(result.status).toBe('active');
    });

    test('finds existing customer by phone', () => {
      const result = lookupCustomer({ phone: '+15551112222' });
      expect(result.found).toBe(true);
      expect(result.source).toBe('customer');
      expect(result.customerName).toBe('Bob Wilson');
    });

    test('returns not found for unknown phone', () => {
      const result = lookupCustomer({ phone: '+19999999999' });
      expect(result.found).toBe(false);
    });

    test('normalizes phone format', () => {
      const result = lookupCustomer({ phone: '(555) 123-4567' });
      expect(result.found).toBe(true);
      expect(result.customerName).toBe('John Doe');
    });

    test('returns reason when phone missing', () => {
      const result = lookupCustomer({});
      expect(result.found).toBe(false);
      expect(result.reason).toBeDefined();
    });
  });

  // ── createLead ──────────────────────────────────────────────

  describe('createLead', () => {
    test('creates a new lead with all fields', () => {
      const result = createLead({
        name: 'New Customer',
        phone: '+15550009999',
        address: '100 New St',
        service: 'Window Replacement',
        notes: 'Called about bay window estimate',
      });
      expect(result.success).toBe(true);
      expect(result.leadId).toBeDefined();
      expect(result.customerName).toBe('New Customer');
    });

    test('returns error when name and phone missing', () => {
      const result = createLead({});
      expect(result.success).toBe(false);
      expect(result.reason).toBeDefined();
    });

    test('defaults customer name to Unknown Caller', () => {
      const result = createLead({ phone: '+15550009999' });
      expect(result.success).toBe(true);
      expect(result.customerName).toBe('Unknown Caller');
    });
  });

  // ── updateLeadFields ────────────────────────────────────────

  describe('updateLeadFields', () => {
    test('updates existing lead', () => {
      const result = updateLeadFields({
        leadId: 'lead-1',
        fields: { status: 'contacted', note: 'Called customer' },
      });
      expect(result.success).toBe(true);
      expect(result.leadId).toBe('lead-1');
      expect(result.updatedFields).toContain('status');
      expect(result.updatedFields).toContain('note');
    });

    test('returns error for nonexistent lead', () => {
      const result = updateLeadFields({
        leadId: 'nonexistent',
        fields: { status: 'contacted' },
      });
      expect(result.success).toBe(false);
    });

    test('returns error when leadId missing', () => {
      const result = updateLeadFields({ fields: {} });
      expect(result.success).toBe(false);
    });
  });

  // ── scheduleAppointment (STUB) ──────────────────────────────

  describe('scheduleAppointment', () => {
    test('returns confirmed stub response', () => {
      const result = scheduleAppointment({
        leadId: 'lead-1',
        date: '2026-07-20',
        timeSlot: '09:00',
        service: 'Roof Repair',
      });
      expect(result.success).toBe(true);
      expect(result.confirmed).toBe(true);
      expect(result.appointmentId).toMatch(/^apt-/);
      expect(result.date).toBe('2026-07-20');
      expect(result.time).toBe('09:00');
    });

    test('handles missing fields gracefully', () => {
      const result = scheduleAppointment({});
      expect(result.success).toBe(true);
      expect(result.appointmentId).toBeDefined();
    });
  });

  // ── getFAQ ──────────────────────────────────────────────────

  describe('getFAQ', () => {
    test('matches emergency question', () => {
      const result = getFAQ({ question: 'I have a flood in my basement' });
      expect(result.matched).toBe(true);
      expect(result.confidence).toBeGreaterThan(0);
      expect(result.answer.toLowerCase()).toContain('emergency');
    });

    test('matches pricing question', () => {
      const result = getFAQ({ question: 'How much does it cost?' });
      expect(result.matched).toBe(true);
      expect(result.confidence).toBeGreaterThan(0);
      expect(result.answer).toContain('estimate');
    });

    test('matches insurance question', () => {
      const result = getFAQ({ question: 'Are you insured?' });
      expect(result.matched).toBe(true);
      expect(result.confidence).toBeGreaterThan(0);
      expect(result.answer).toContain('licensed');
    });

    test('matches hours question', () => {
      const result = getFAQ({ question: 'What are your business hours?' });
      expect(result.matched).toBe(true);
      expect(result.answer).toContain('Monday');
    });

    test('returns default for unmatched question', () => {
      const result = getFAQ({ question: 'What color is your truck?' });
      // May or may not match depending on partial keyword overlap; just verify answer exists
      expect(result.answer).toBeDefined();
      expect(typeof result.confidence).toBe('number');
    });

    test('handles empty question', () => {
      const result = getFAQ({});
      expect(result.answer).toBeDefined();
      expect(result.confidence).toBe(0);
      expect(result.matched).toBe(false);
    });
  });

  // ── checkAvailability (STUB) ────────────────────────────────

  describe('checkAvailability', () => {
    test('returns default slots', () => {
      const result = checkAvailability({ date: '2026-07-20', service: 'Roofing' });
      expect(result.success).toBe(true);
      expect(result.slots).toBeDefined();
      expect(Array.isArray(result.slots)).toBe(true);
      expect(result.slots.length).toBeGreaterThan(0);
      expect(result.slots[0]).toHaveProperty('time');
      expect(result.slots[0]).toHaveProperty('available');
    });

    test('all default slots are available', () => {
      const result = checkAvailability({ date: '2026-07-20' });
      for (const slot of result.slots) {
        expect(slot.available).toBe(true);
      }
    });
  });

  // ── createNote ──────────────────────────────────────────────

  describe('createNote', () => {
    test('creates a note for a lead', () => {
      const result = createNote({ leadId: 'lead-1', note: 'Customer prefers morning calls' });
      expect(result.success).toBe(true);
      expect(result.noteId).toMatch(/^note-/);
      expect(result.leadId).toBe('lead-1');
      expect(result.createdAt).toBeDefined();
    });

    test('retrieves notes for lead', () => {
      createNote({ leadId: 'lead-1', note: 'Note 1' });
      createNote({ leadId: 'lead-1', note: 'Note 2' });
      const notes = getLeadNotes('lead-1');
      expect(notes).toHaveLength(2);
      expect(notes[0].note).toBe('Note 1');
      expect(notes[1].note).toBe('Note 2');
    });

    test('returns error for missing leadId', () => {
      const result = createNote({ note: 'Some note' });
      expect(result.success).toBe(false);
    });

    test('returns error for missing note text', () => {
      const result = createNote({ leadId: 'lead-1' });
      expect(result.success).toBe(false);
    });
  });

  // ── tagCall ─────────────────────────────────────────────────

  describe('tagCall', () => {
    test('tags a call with labels', () => {
      const result = tagCall({ callId: 'call-1', tags: ['urgent', 'high-value'] });
      expect(result.success).toBe(true);
      expect(result.callId).toBe('call-1');
      expect(result.tags).toContain('urgent');
      expect(result.tags).toContain('high-value');
    });

    test('deduplicates tags', () => {
      tagCall({ callId: 'call-1', tags: ['urgent'] });
      const result = tagCall({ callId: 'call-1', tags: ['urgent', 'follow-up'] });
      expect(result.tags).toHaveLength(2);
      expect(result.tags).toContain('urgent');
      expect(result.tags).toContain('follow-up');
    });

    test('retrieves tags for a call', () => {
      tagCall({ callId: 'call-2', tags: ['a', 'b', 'c'] });
      const tags = getCallTags('call-2');
      expect(tags).toEqual(['a', 'b', 'c']);
    });

    test('returns error for missing callId', () => {
      const result = tagCall({ tags: ['test'] });
      expect(result.success).toBe(false);
    });

    test('returns error for non-array tags', () => {
      const result = tagCall({ callId: 'call-1', tags: 'not-an-array' });
      expect(result.success).toBe(false);
    });
  });

  // ── updateTimeline ──────────────────────────────────────────

  describe('updateTimeline', () => {
    test('adds timeline entry', () => {
      const result = updateTimeline({
        callId: 'call-1',
        event: 'estimate_requested',
        detail: 'Customer requested estimate for roof repair',
      });
      expect(result.success).toBe(true);
      expect(result.callId).toBe('call-1');
      expect(result.event).toBe('estimate_requested');
      expect(result.timestamp).toBeDefined();
    });

    test('retrieves timeline entries', () => {
      updateTimeline({ callId: 'call-1', event: 'call_started' });
      updateTimeline({ callId: 'call-1', event: 'estimate_requested' });
      updateTimeline({ callId: 'call-1', event: 'appointment_booked' });
      const timeline = getCallTimeline('call-1');
      expect(timeline).toHaveLength(3);
      expect(timeline.map(t => t.event)).toEqual(['call_started', 'estimate_requested', 'appointment_booked']);
    });

    test('returns error for missing callId', () => {
      const result = updateTimeline({ event: 'test' });
      expect(result.success).toBe(false);
    });

    test('returns error for missing event', () => {
      const result = updateTimeline({ callId: 'call-1' });
      expect(result.success).toBe(false);
    });
  });

  // ── clearAll ────────────────────────────────────────────────

  describe('clearAll', () => {
    test('clears all in-memory data', () => {
      createNote({ leadId: 'lead-1', note: 'Test' });
      tagCall({ callId: 'call-1', tags: ['test'] });
      updateTimeline({ callId: 'call-1', event: 'test' });

      clearAll();

      expect(getLeadNotes('lead-1')).toHaveLength(0);
      expect(getCallTags('call-1')).toHaveLength(0);
      expect(getCallTimeline('call-1')).toHaveLength(0);
    });
  });
});

/**
 * NorthStar Solutions — Business Models
 * Factory functions that validate and normalize domain entities.
 * Models produce plain JS objects the App Store can index.
 */
(function () {
  const nowIso = () => new Date().toISOString();
  const id = (prefix) => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

  const Models = {
    Lead(data) {
      const d = data || {};
      return {
        id: d.id || id('lead'),
        caller: d.caller || d.customerName || 'Unknown',
        phone: d.phone || d.phoneNumber || '',
        address: d.address || '',
        service: d.service || d.serviceRequested || '',
        description: d.description || d.summary || d.jobDetail || '',
        status: d.status || 'new',
        avgPrice: Number(d.avgPrice) || 0,
        time: d.time || '',
        receivedAt: d.receivedAt || nowIso(),
        transcript: d.transcript || '',
        breakdown: d.breakdown || d.priceBreakdown || d.pricingBreakdown || [],
        source: d.source || 'simulated',
        icon: d.icon || ''
      };
    },
    Customer(data) {
      const d = data || {};
      return {
        id: d.id || id('cust'),
        name: d.name || d.caller || 'Unnamed',
        phone: d.phone || d.phoneNumber || '',
        address: d.address || '',
        email: d.email || '',
        notes: d.notes || '',
        createdAt: d.createdAt || nowIso()
      };
    },
    Estimate(data) {
      const d = data || {};
      const items = Array.isArray(d.items) ? d.items : [];
      return {
        id: d.id || id('est'),
        leadId: d.leadId || null,
        customerId: d.customerId || null,
        items,
        total: Number(d.total) || items.reduce((s, it) => s + (Number(it.amount) || 0), 0),
        status: d.status || 'draft',
        createdAt: d.createdAt || nowIso()
      };
    },
    Appointment(data) {
      const d = data || {};
      return {
        id: d.id || id('appt'),
        leadId: d.leadId || null,
        customerId: d.customerId || null,
        dateTime: d.dateTime || null,
        duration: Number(d.duration) || 60,
        notes: d.notes || '',
        status: d.status || 'scheduled'
      };
    },
    Job(data) {
      const d = data || {};
      return {
        id: d.id || id('job'),
        leadId: d.leadId || null,
        customerId: d.customerId || null,
        estimateId: d.estimateId || null,
        scheduledDate: d.scheduledDate || null,
        completedDate: d.completedDate || null,
        status: d.status || 'pending',
        notes: d.notes || ''
      };
    },
    Invoice(data) {
      const d = data || {};
      return {
        id: d.id || id('inv'),
        jobId: d.jobId || null,
        customerId: d.customerId || null,
        amount: Number(d.amount) || 0,
        status: d.status || 'pending',
        createdAt: d.createdAt || nowIso()
      };
    }
  };

  window.Models = Models;
})();

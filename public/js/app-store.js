/**
 * NorthStar Solutions — App Store
 * Singleton centralized state container. Emits events via window.EventBus
 * on every mutation. Exposed on window.AppStore.
 */
(function () {
  if (!window.EventBus) { console.warn('[AppStore] EventBus missing — load event-bus.js first'); }
  if (!window.Models) { console.warn('[AppStore] Models missing — load business-models.js first'); }

  const isToday = (d) => {
    if (!d) return false;
    const t = new Date(d);
    if (isNaN(t.getTime())) return false;
    const n = new Date();
    return t.toDateString() === n.toDateString();
  };

  const initialState = () => ({
    leads: [],
    customers: [],
    estimates: [],
    appointments: [],
    jobs: [],
    invoices: [],
    transcripts: [],
    polarisInsights: [],
    notifications: [],
    settings: { theme: 'light' },
    ui: {
      selectedLeadId: null,
      drawerOpen: false,
      currentFilters: {},
      currentSearch: '',
      currentSort: ''
    }
  });

  const AppStore = {
    state: initialState(),

    // ── Subscription helper (delegates to EventBus)
    subscribe(event, cb) { return window.EventBus ? window.EventBus.on(event, cb) : () => {}; },

    // ── Leads
    addLead(lead) {
      const normalized = window.Models ? window.Models.Lead(lead) : lead;
      this.state.leads.unshift(normalized);
      if (window.EventBus) {
        window.EventBus.emit('lead:created', normalized);
        window.EventBus.emit('store:changed', { type: 'lead:created', lead: normalized });
      }
      return normalized;
    },
    updateLead(idOrIndex, patch) {
      const lead = this._findLead(idOrIndex);
      if (!lead) return null;
      Object.assign(lead, patch || {});
      if (window.EventBus) {
        window.EventBus.emit('lead:updated', lead);
        window.EventBus.emit('store:changed', { type: 'lead:updated', lead });
      }
      return lead;
    },
    removeLead(idOrIndex) {
      const idx = typeof idOrIndex === 'number' ? idOrIndex : this.state.leads.findIndex(l => l.id === idOrIndex);
      if (idx < 0 || idx >= this.state.leads.length) return null;
      const [removed] = this.state.leads.splice(idx, 1);
      if (window.EventBus) {
        window.EventBus.emit('lead:deleted', removed);
        window.EventBus.emit('store:changed', { type: 'lead:deleted', lead: removed });
      }
      return removed;
    },
    getLeads() { return this.state.leads; },
    getLead(idOrIndex) { return this._findLead(idOrIndex); },
    _findLead(idOrIndex) {
      if (typeof idOrIndex === 'number') return this.state.leads[idOrIndex] || null;
      return this.state.leads.find(l => l.id === idOrIndex) || null;
    },

    // ── Customers
    addCustomer(c) {
      const customer = window.Models ? window.Models.Customer(c) : c;
      this.state.customers.push(customer);
      if (window.EventBus) window.EventBus.emit('customer:created', customer);
      return customer;
    },
    getCustomers() { return this.state.customers; },

    // ── Appointments
    addAppointment(a) {
      const appt = window.Models ? window.Models.Appointment(a) : a;
      this.state.appointments.push(appt);
      if (window.EventBus) window.EventBus.emit('appointment:created', appt);
      return appt;
    },
    getAppointments() { return this.state.appointments; },

    // ── Estimates / Jobs / Invoices (lightweight helpers)
    addEstimate(e) { const est = window.Models ? window.Models.Estimate(e) : e; this.state.estimates.push(est); if (window.EventBus) window.EventBus.emit('estimate:created', est); return est; },
    addJob(j)     { const job = window.Models ? window.Models.Job(j)     : j; this.state.jobs.push(job);         if (window.EventBus) window.EventBus.emit('job:created', job);     return job; },
    addInvoice(i) { const inv = window.Models ? window.Models.Invoice(i) : i; this.state.invoices.push(inv);     if (window.EventBus) window.EventBus.emit('invoice:created', inv); return inv; },

    // ── Notifications
    pushNotification(n) {
      const note = Object.assign({ id: 'n_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6), createdAt: new Date().toISOString() }, n || {});
      this.state.notifications.unshift(note);
      if (this.state.notifications.length > 50) this.state.notifications.pop();
      if (window.EventBus) window.EventBus.emit('notification:created', note);
      return note;
    },

    // ── Settings
    setSetting(key, value) {
      this.state.settings[key] = value;
      if (window.EventBus) window.EventBus.emit('settings:changed', { key, value });
    },
    getSetting(key) { return this.state.settings[key]; },

    // ── UI
    setUi(patch) { Object.assign(this.state.ui, patch || {}); if (window.EventBus) window.EventBus.emit('ui:changed', this.state.ui); },

    // ── KPI computation
    getKpis() {
      const leads = this.state.leads;
      const totalLeads = leads.length;
      const qualified = leads.filter(l => l.status === 'scheduled' || l.status === 'contacted' || l.status === 'new').length;
      const scheduled = leads.filter(l => l.status === 'scheduled').length;
      const won = leads.filter(l => l.status === 'completed').length;
      const pipeline = leads.reduce((s, l) => s + (Number(l.avgPrice) || 0), 0);
      const revenue = pipeline; // alias — currently same calculation
      const conversionRate = qualified > 0 ? Math.round((won / qualified) * 100) : 0;
      const avgLeadValue = totalLeads > 0 ? Math.round(pipeline / totalLeads) : 0;
      const topOpportunity = leads.slice().sort((a, b) => (b.avgPrice || 0) - (a.avgPrice || 0))[0] || null;
      const today = leads.filter(l => isToday(l.receivedAt || l.time)).length;

      return {
        totalLeads,
        qualified,
        scheduled,
        won,
        pipeline,
        revenue,
        conversionRate,
        avgLeadValue,
        topOpportunity,
        today
      };
    },

    // ── Reset (testing / dev)
    reset() {
      this.state = initialState();
      if (window.EventBus) window.EventBus.emit('store:reset', this.state);
    }
  };

  window.AppStore = AppStore;
})();

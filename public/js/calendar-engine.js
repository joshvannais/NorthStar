/**
 * NorthStar Calendar Engine — Clean rebuild for mockup match
 * One calendar, one intelligence section, one schedule list.
 */
"use strict";

// ================================================================
// CalendarState
// ================================================================
class CalendarState {
  constructor() {
    this.view = 'month';
    this.currentDate = new Date();
    this.events = [];
    this.selectedDate = null;
    this.selectedEvent = null;
    this.listeners = [];
  }

  get year() { return this.currentDate.getFullYear(); }
  get month() { return this.currentDate.getMonth(); }

  getMonthStart() { return new Date(this.year, this.month, 1); }
  getMonthEnd() { return new Date(this.year, this.month + 1, 0); }
  getDaysInMonth() { return new Date(this.year, this.month + 1, 0).getDate(); }
  getFirstDayOfMonth() { return this.getMonthStart().getDay(); }

  getMonthLabel() {
    const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    return months[this.month] + ' ' + this.year;
  }

  getWeekStart() { const d = new Date(this.currentDate); d.setDate(d.getDate() - d.getDay()); return d; }

  getWeekDays() {
    const start = this.getWeekStart();
    const days = [];
    for (let i = 0; i < 7; i++) { const d = new Date(start); d.setDate(d.getDate() + i); days.push(d); }
    return days;
  }

  getEventsForDate(date) { return this.events.filter(e => e.date === this._formatDate(date)); }
  getEventsForMonth() { const s = this._formatDate(this.getMonthStart()); const e = this._formatDate(this.getMonthEnd()); return this.events.filter(ev => ev.date >= s && ev.date <= e); }
  getEventsForWeek() { const d = this.getWeekDays(); return this.events.filter(ev => ev.date >= this._formatDate(d[0]) && ev.date <= this._formatDate(d[6])); }

  navigate(delta) {
    if (this.view === 'month') this.currentDate.setMonth(this.currentDate.getMonth() + delta);
    else if (this.view === 'week' || this.view === 'day') this.currentDate.setDate(this.currentDate.getDate() + (delta * 7));
    this._notify();
  }

  goToday() { this.currentDate = new Date(); this.selectedDate = null; this.selectedEvent = null; this._notify(); }
  setView(view) { this.view = view; this.selectedEvent = null; this._notify(); }
  selectDate(date) { this.selectedDate = date; this.selectedEvent = null; this._notify(); }
  selectEvent(event) { this.selectedEvent = event; this._notify(); }
  onChange(fn) { this.listeners.push(fn); }
  _notify() { this.listeners.forEach(fn => fn(this)); }
  _formatDate(date) { const y = date.getFullYear(); const m = String(date.getMonth()+1).padStart(2,'0'); const d = String(date.getDate()).padStart(2,'0'); return `${y}-${m}-${d}`; }
  isToday(date) { const t = new Date(); return this._formatDate(date) === this._formatDate(t); }
  isSelected(date) { if (!this.selectedDate) return false; return this._formatDate(date) === this._formatDate(this.selectedDate); }
}

// ================================================================
// CalendarRenderer
// ================================================================
class CalendarRenderer {
  constructor(state) {
    this.state = state;
    this.container = document.getElementById('calendarGrid');
    this.sidebar = document.getElementById('calendarSidebar');
    this.header = document.getElementById('calendarHeader');
    this.kpiBar = document.getElementById('calendarKpiBar');
    this.polaris = document.getElementById('calendarPolaris');
  }

  render() {
    this.renderHeader();
    this.renderKpiBar();
    switch (this.state.view) {
      case 'month': this.renderMonth(); break;
      case 'week': this.renderWeek(); break;
      case 'day': this.renderDay(); break;
      case 'agenda': this.renderAgenda(); break;
    }
    this.renderSidebar();
    this.renderPolaris();
  }

  renderHeader() {
    if (!this.header) return;
    this.header.innerHTML = `
      <div class="cal-header-left">
        <h1 class="cal-title">${this.state.getMonthLabel()}</h1>
        <div class="cal-nav-btns">
          <button class="cal-nav-btn" onclick="window.calState.navigate(-1)">‹</button>
          <button class="cal-nav-btn" onclick="window.calState.navigate(1)">›</button>
          <button class="cal-today-btn" onclick="window.calState.goToday()">Today</button>
        </div>
      </div>
      <div class="cal-header-right">
        <div class="cal-view-tabs">
          <button class="cal-view-tab ${this.state.view === 'month' ? 'active' : ''}" onclick="window.calState.setView('month')">Month</button>
          <button class="cal-view-tab ${this.state.view === 'week' ? 'active' : ''}" onclick="window.calState.setView('week')">Week</button>
          <button class="cal-view-tab ${this.state.view === 'day' ? 'active' : ''}" onclick="window.calState.setView('day')">Day</button>
          <button class="cal-view-tab ${this.state.view === 'agenda' ? 'active' : ''}" onclick="window.calState.setView('agenda')">Agenda</button>
        </div>
      </div>`;
  }

  renderKpiBar() {
    if (!this.kpiBar) return;
    const monthEvents = this.state.getEventsForMonth();
    const today = new Date();
    const todayStr = this.state._formatDate(today);
    const todayEvents = this.state.events.filter(e => e.date === todayStr);
    const total = this.state.events.length;

    // Pipeline: single source of truth — same AppStore selectors as Dashboard
    const allLeads = (typeof window.AppStore !== 'undefined' && window.AppStore.getLeads) ? window.AppStore.getLeads() : (window.__leads || []);
    const qualifiedLeads = allLeads.filter(l => l.status === 'new' || l.status === 'contacted' || l.status === 'qualified');
    const pipelineValue = qualifiedLeads.reduce((sum, l) => sum + (parseFloat(l.avgPrice || l.estimated_price) || 0), 0);

    this.kpiBar.innerHTML = `
      <span class="cal-kpi-pill" style="display:inline-flex;align-items:center;gap:5px;padding:4px 10px;background:var(--neutral-800);border:1px solid rgba(255,255,255,0.06);border-radius:6px;font-size:12px;color:#9aa0a6;white-space:nowrap;">
        <span style="font-size:14px;">📅</span>
        <strong style="color:#e8eaed;font-weight:600;">${monthEvents.length}</strong>
        <span style="color:#6c7278;">appointments</span>
      </span>
      <span class="cal-kpi-pill" style="display:inline-flex;align-items:center;gap:5px;padding:4px 10px;background:var(--neutral-800);border:1px solid rgba(255,255,255,0.06);border-radius:6px;font-size:12px;color:#9aa0a6;white-space:nowrap;">
        <span style="font-size:14px;">📞</span>
        <strong style="color:#e8eaed;font-weight:600;">${todayEvents.length}</strong>
        <span style="color:#6c7278;">today</span>
      </span>
      <span class="cal-kpi-pill" style="display:inline-flex;align-items:center;gap:5px;padding:4px 10px;background:var(--neutral-800);border:1px solid rgba(255,255,255,0.06);border-radius:6px;font-size:12px;color:#9aa0a6;white-space:nowrap;">
        <span style="font-size:14px;">📊</span>
        <strong style="color:#e8eaed;font-weight:600;">${total}</strong>
        <span style="color:#6c7278;">events</span>
      </span>
      <span class="cal-kpi-pill" style="display:inline-flex;align-items:center;gap:5px;padding:4px 10px;background:var(--neutral-800);border:1px solid rgba(255,255,255,0.06);border-radius:6px;font-size:12px;color:#9aa0a6;white-space:nowrap;">
        <span style="font-size:14px;">💰</span>
        <strong style="color:#e8eaed;font-weight:600;">$${pipelineValue.toLocaleString()}</strong>
        <span style="color:#6c7278;">pipeline</span>
      </span>`;
  }

  renderMonth() {
    if (!this.container) return;
    const daysInMonth = this.state.getDaysInMonth();
    const firstDay = this.state.getFirstDayOfMonth();
    const monthEvents = this.state.getEventsForMonth();

    let html = '<div class="cal-month-grid">';
    ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].forEach(d => { html += `<div class="cal-month-day-header">${d}</div>`; });
    for (let i = 0; i < firstDay; i++) html += '<div class="cal-month-cell cal-month-cell-empty"></div>';

    const today = new Date();
    const todayStr = this.state._formatDate(today);
    const selectedStr = this.state.selectedDate ? this.state._formatDate(this.state.selectedDate) : null;

    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(this.state.year, this.state.month, day);
      const dateStr = this.state._formatDate(date);
      const dayEvents = monthEvents.filter(e => e.date === dateStr);
      const isToday = dateStr === todayStr;
      const isSelected = dateStr === selectedStr;

      let cls = 'cal-month-cell';
      if (isToday) cls += ' cal-month-cell-today';
      if (isSelected) cls += ' cal-month-cell-selected';
      if (dayEvents.length > 0) cls += ' cal-month-cell-has-events';

      html += `<div class="${cls}" onclick="window.calState.selectDate(new Date(${date.getFullYear()}, ${date.getMonth()}, ${day}))">`;
      html += `<div class="cal-month-cell-day">${day}</div>`;
      if (dayEvents.length > 0) {
        html += '<div class="cal-month-cell-events">';
        dayEvents.slice(0, 3).forEach(e => {
          html += `<div class="cal-month-event-dot" style="background:${e.color || '#6395ff'}" title="${e.title || 'Event'}"></div>`;
        });
        if (dayEvents.length > 3) html += `<span class="cal-month-event-more">+${dayEvents.length - 3} more</span>`;
        html += '</div>';
      }
      html += '</div>';
    }
    html += '</div>';
    this.container.innerHTML = html;
  }

  renderWeek() {
    if (!this.container) return;
    const days = this.state.getWeekDays();
    const weekEvents = this.state.getEventsForWeek();
    let html = '<div class="cal-week-view"><div class="cal-week-grid">';

    html += '<div class="cal-week-row cal-week-header"><div class="cal-week-time-header"></div>';
    days.forEach(d => {
      const dayName = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d.getDay()];
      const isToday = this.state.isToday(d);
      html += `<div class="cal-week-day-header ${isToday ? 'cal-week-day-header-today' : ''}">${dayName} ${d.getDate()}</div>`;
    });
    html += '</div>';

    for (let hour = 6; hour <= 21; hour++) {
      html += '<div class="cal-week-row">';
      html += `<div class="cal-week-time">${hour === 0 ? '12 AM' : hour < 12 ? hour + ' AM' : hour === 12 ? '12 PM' : (hour - 12) + ' PM'}</div>`;
      days.forEach(d => {
        const dateStr = this.state._formatDate(d);
        const timeStr = String(hour).padStart(2, '0');
        const hourEvents = weekEvents.filter(e => e.date === dateStr && e.time && e.time.startsWith(timeStr));
        html += `<div class="cal-week-cell" onclick="window.calState.selectDate(new Date(${d.getFullYear()}, ${d.getMonth()}, ${d.getDate()}))">`;
        hourEvents.forEach(e => {
          html += `<div class="cal-week-event" style="background:${e.color || '#6395ff'}" onclick="event.stopPropagation(); window.calState.selectEvent(window.calState.events.find(ev => ev.id === '${e.id}'))">${e.title}</div>`;
        });
        html += '</div>';
      });
      html += '</div>';
    }
    html += '</div></div>';
    this.container.innerHTML = html;
  }

  renderDay() {
    if (!this.container) return;
    const date = this.state.selectedDate || this.state.currentDate;
    const dateStr = this.state._formatDate(date);
    const dayEvents = this.state.events.filter(e => e.date === dateStr);
    let html = '<div class="cal-day-view">';
    html += `<h2 class="cal-day-title">${date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</h2>`;
    for (let hour = 6; hour <= 21; hour++) {
      const timeStr = String(hour).padStart(2,'0');
      const hourEvents = dayEvents.filter(e => e.time && e.time.startsWith(timeStr));
      html += '<div class="cal-day-row">';
      html += `<div class="cal-day-time">${hour === 0 ? '12 AM' : hour < 12 ? hour + ' AM' : hour === 12 ? '12 PM' : (hour - 12) + ' PM'}</div>`;
      html += '<div class="cal-day-content">';
      hourEvents.forEach(e => {
        html += `<div class="cal-day-event-card" style="border-left:3px solid ${e.color || '#6395ff'}" onclick="window.calState.selectEvent(window.calState.events.find(ev => ev.id === '${e.id}'))">`;
        html += `<div class="cal-day-event-time">${e.time || ''}</div>`;
        html += `<div class="cal-day-event-title">${e.title}</div>`;
        if (e.description) html += `<div class="cal-day-event-desc">${e.description}</div>`;
        html += '</div>';
      });
      html += '</div></div>';
    }
    html += '</div>';
    this.container.innerHTML = html;
  }

  renderAgenda() {
    if (!this.container) return;
    const sorted = [...this.state.events].sort((a, b) => { if (a.date < b.date) return -1; if (a.date > b.date) return 1; if (a.time && b.time) return a.time.localeCompare(b.time); return 0; });
    let html = '<div class="cal-agenda-view">';
    if (sorted.length === 0) {
      const allLeads = (typeof window.AppStore !== 'undefined' && window.AppStore.getLeads) ? window.AppStore.getLeads() : [];
      html += '<div class="cal-agenda-empty">';
      html += '<div style="font-size:32px;margin-bottom:12px;">📅</div>';
      html += '<div style="font-size:16px;font-weight:600;color:#9aa0a6;margin-bottom:8px;">No events scheduled</div>';
      if (allLeads.length > 0) {
        html += '<div style="font-size:13px;color:#6c7278;margin-bottom:12px;">You have leads ready to schedule. Click a day to create an event.</div>';
      } else {
        html += '<div style="font-size:13px;color:#6c7278;margin-bottom:12px;">Click a day to create an event, or receive calls to auto-schedule appointments.</div>';
        if (typeof window.genCall === 'function') {
          html += '<button onclick="window.genCall();setTimeout(()=>window.refreshCalendar(),1500)" style="padding:8px 20px;background:#6395ff;color:white;border:none;border-radius:6px;font-size:13px;font-weight:600;cursor:pointer;">📞 Simulate a lead</button>';
        }
      }
      html += '</div>';
    } else {
      let currentDate = '';
      sorted.forEach(e => {
        const dateObj = new Date(e.date + 'T12:00:00');
        const dateLabel = dateObj.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
        const isToday = this.state._formatDate(new Date()) === e.date;
        if (e.date !== currentDate) {
          if (currentDate !== '') html += '</div>';
          currentDate = e.date;
          html += `<div class="cal-agenda-date ${isToday ? 'cal-agenda-date-today' : ''}">${dateLabel}${isToday ? ' — Today' : ''}</div>`;
          html += '<div class="cal-agenda-events">';
        }
        html += `<div class="cal-agenda-event" onclick="window.calState.selectEvent(window.calState.events.find(ev => ev.id === '${e.id}'))">`;
        html += `<div class="cal-agenda-event-color" style="background:${e.color || '#6395ff'}"></div>`;
        html += '<div class="cal-agenda-event-info">';
        html += `<div class="cal-agenda-event-title">${e.title}</div>`;
        if (e.time) html += `<div class="cal-agenda-event-time">${e.time}</div>`;
        if (e.description) html += `<div class="cal-agenda-event-desc">${e.description}</div>`;
        html += '</div></div>';
      });
      html += '</div></div>';
    }
    html += '</div>';
    this.container.innerHTML = html;
  }

  renderSidebar() {
    if (!this.sidebar) return;
    const today = new Date();
    const todayStr = this.state._formatDate(today);
    const selectedDate = this.state.selectedDate || today;
    const selectedStr = this.state._formatDate(selectedDate);
    const dayEvents = this.state.events.filter(e => e.date === selectedStr);

    let html = '<div class="cal-sidebar-section">';
    html += '<div class="cal-mini-header">';
    html += `<button class="cal-mini-nav" onclick="window.calState.navigate(-1)">‹</button>`;
    html += `<span class="cal-mini-label">${selectedDate.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}</span>`;
    html += `<button class="cal-mini-nav" onclick="window.calState.navigate(1)">›</button>`;
    html += '</div><div class="cal-mini-grid">';
    ['S','M','T','W','T','F','S'].forEach(d => { html += `<div class="cal-mini-day-header">${d}</div>`; });
    const firstDay = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1).getDay();
    const daysInMonth = new Date(selectedDate.getFullYear(), selectedDate.getMonth() + 1, 0).getDate();
    for (let i = 0; i < firstDay; i++) html += '<div class="cal-mini-cell cal-mini-empty"></div>';
    for (let d = 1; d <= daysInMonth; d++) {
      const date = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), d);
      const dateStr = this.state._formatDate(date);
      let cls = 'cal-mini-cell';
      if (dateStr === todayStr) cls += ' cal-mini-today';
      if (dateStr === selectedStr) cls += ' cal-mini-selected';
      html += `<div class="${cls}" onclick="window.calState.selectDate(new Date(${date.getFullYear()}, ${date.getMonth()}, ${d}))">${d}</div>`;
    }
    html += '</div></div>';

    // Day events
    html += '<div class="cal-sidebar-section">';
    html += `<h3 class="cal-sidebar-title">${selectedDate.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}</h3>`;
    if (dayEvents.length === 0) {
      html += '<p class="cal-sidebar-empty">No events</p>';
    } else {
      dayEvents.forEach(e => {
        html += `<div class="cal-sidebar-event" onclick="window.calState.selectEvent(window.calState.events.find(ev => ev.id === '${e.id}'))">`;
        html += `<div class="cal-sidebar-event-dot" style="background:${e.color || '#6395ff'}"></div>`;
        html += '<div class="cal-sidebar-event-info">';
        html += `<div class="cal-sidebar-event-title">${e.title}</div>`;
        if (e.time) html += `<div class="cal-sidebar-event-time">${e.time}</div>`;
        html += '</div></div>';
      });
    }
    html += '</div>';

    // New Event button
    html += '<button class="cal-new-event-btn" onclick="window.openEventModal()">+ New Event</button>';
    this.sidebar.innerHTML = html;
  }

  // ================================================================
  // Polaris — Executive intelligence panel (Dashboard design language)
  // ================================================================
  renderPolaris() {
    if (!this.polaris) return;
    const allLeads = (typeof window.AppStore !== 'undefined' && window.AppStore.getLeads) ? window.AppStore.getLeads() : (window.__leads || []);
    const qualifiedLeads = allLeads.filter(l => l.status === 'new' || l.status === 'contacted' || l.status === 'qualified');
    const totalPipeline = qualifiedLeads.reduce((sum, l) => sum + (parseFloat(l.avgPrice || l.estimated_price) || 0), 0);
    const topLead = qualifiedLeads.length > 0 ? qualifiedLeads.sort((a,b) => (parseFloat(b.avgPrice || b.estimated_price)||0) - (parseFloat(a.avgPrice || a.estimated_price)||0))[0] : null;
    const today = new Date();
    const todayStr = this.state._formatDate(today);
    const todayEvents = this.state.events.filter(e => e.date === todayStr);
    const leadEvents = this.state.events.filter(e => e.type === 'lead');
    const dayRevenue = leadEvents.reduce((sum, e) => sum + (parseFloat(e.estimatedPrice) || 0), 0);
    const appointmentsToday = todayEvents.filter(e => e.type === 'lead').length || leadEvents.length;

    let html = '<div class="polaris-card">';
    // Header
    html += '<div class="polaris-header">';
    html += '<h2 style="font-size:15px;font-weight:600;color:var(--neutral-100);display:flex;align-items:center;gap:8px;margin:0;">POLARIS<span style="font-size:10px;color:var(--neutral-400);font-weight:400;">™</span> Intelligence</h2>';
    html += '<span class="polaris-badge" style="background:#a67c00;color:#fff;">✦ DAY ANALYSIS</span>';
    html += '</div>';
    // Body — vertically stacked rows
    html += '<div class="polaris-grid" style="display:flex;flex-direction:column;gap:0;">';
    // Appointments Today
    html += '<div class="polaris-item">';
    html += '<div class="polaris-item-label">Appointments Today</div>';
    html += `<div class="polaris-item-value">${appointmentsToday}</div>`;
    html += '<div class="polaris-item-desc">Scheduled for today</div>';
    html += '</div>';
    // Today's Revenue
    html += '<div class="polaris-item">';
    html += '<div class="polaris-item-label">Today\u2019s Revenue</div>';
    html += `<div class="polaris-item-value">$${dayRevenue.toLocaleString()}</div>`;
    html += '<div class="polaris-item-desc">Estimated from appointments</div>';
    html += '</div>';
    // Pipeline Value
    html += '<div class="polaris-item">';
    html += '<div class="polaris-item-label">Pipeline Value</div>';
    html += `<div class="polaris-item-value">$${totalPipeline.toLocaleString()}</div>`;
    html += '<div class="polaris-item-desc">Total qualified pipeline</div>';
    html += '</div>';
    // Top Priority Lead
    if (topLead) {
      const name = topLead.caller_name || topLead.caller || 'Lead';
      const service = topLead.service_type || topLead.service || 'Service';
      html += '<div class="polaris-item">';
      html += '<div class="polaris-item-label">Top Priority</div>';
      html += `<div class="polaris-item-value" style="font-size:14px;">${name}</div>`;
      html += `<div class="polaris-item-desc">${service} \u2014 $${(parseFloat(topLead.avgPrice || topLead.estimated_price)||0).toLocaleString()}</div>`;
      html += '</div>';
      // Polaris Recommendation
      html += '<div class="polaris-item" style="border-bottom:none;">';
      html += '<div class="polaris-item-label">Recommendation</div>';
      html += `<div class="polaris-item-value" style="font-size:13px;font-weight:500;color:var(--neutral-100);">Follow up with ${name} today</div>`;
      html += '<div class="polaris-item-desc">Prioritize this opportunity</div>';
      html += '</div>';
      // Polaris Insight
      html += '<div class="polaris-item" style="border-bottom:none;padding-top:4px;">';
      html += '<div class="polaris-item-label">Insight</div>';
      html += `<div class="polaris-item-value" style="font-size:13px;font-weight:400;color:var(--neutral-300);">${name} is your highest-value lead at $$${(parseFloat(topLead.avgPrice || topLead.estimated_price)||0).toLocaleString()}</div>`;
      html += '</div>';
    } else {
      // No qualified leads — show intelligence anyway
      html += '<div class="polaris-item">';
      html += '<div class="polaris-item-label">Top Priority</div>';
      html += '<div class="polaris-item-value" style="font-size:14px;color:var(--neutral-400);">No active leads</div>';
      html += '<div class="polaris-item-desc">Pipeline is empty</div>';
      html += '</div>';
      html += '<div class="polaris-item" style="border-bottom:none;">';
      html += '<div class="polaris-item-label">Recommendation</div>';
      html += '<div class="polaris-item-value" style="font-size:13px;font-weight:500;color:var(--neutral-300);">Generate new leads to build your pipeline</div>';
      html += '<div class="polaris-item-desc">Start with outreach or inbound calls</div>';
      html += '</div>';
    }
    html += '</div></div>'; // close polaris-grid, polaris-card
    this.polaris.innerHTML = html;
  }
}

// ================================================================
// CalendarData — API calls
// ================================================================
class CalendarData {
  constructor() { this.baseUrl = '/api/v1/calendar'; }

  async fetchEvents() {
    try { const r = await fetch(`${this.baseUrl}/events`); const d = await r.json(); return d.events || []; }
    catch(e) { console.warn('[CalendarData] fetchEvents:', e.message); return []; }
  }

  async createEvent(data) {
    try { const r = await fetch(`${this.baseUrl}/events`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(data) }); const d = await r.json(); return d.event; }
    catch(e) { console.warn('[CalendarData] createEvent:', e.message); return null; }
  }

  async updateEvent(id, data) {
    try { const r = await fetch(`${this.baseUrl}/events/${id}`, { method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify(data) }); const d = await r.json(); return d.event; }
    catch(e) { console.warn('[CalendarData] updateEvent:', e.message); return null; }
  }

  async deleteEvent(id) {
    try { const r = await fetch(`${this.baseUrl}/events/${id}`, { method:'DELETE' }); return r.ok; }
    catch(e) { console.warn('[CalendarData] deleteEvent:', e.message); return false; }
  }

  async exportICS() {
    try { const r = await fetch(`${this.baseUrl}/export/ics`); const blob = await r.blob(); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'calendar.ics'; a.click(); URL.revokeObjectURL(url); }
    catch(e) { console.warn('[CalendarData] exportICS:', e.message); }
  }

  async importICS(icsContent) {
    try { const r = await fetch(`${this.baseUrl}/import/ics`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({icsContent}) }); return await r.json(); }
    catch(e) { console.warn('[CalendarData] importICS:', e.message); return null; }
  }
}

// ================================================================
// CalendarModal
// ================================================================
class CalendarModal {
  _formatDate(date) { const y=date.getFullYear(); const m=String(date.getMonth()+1).padStart(2,'0'); const d=String(date.getDate()).padStart(2,'0'); return `${y}-${m}-${d}`; }

  openCreateEvent(date) {
    const dateStr = date ? this._formatDate(date) : new Date().toISOString().split('T')[0];
    const html = `
      <div class="cal-modal-overlay" id="calModalOverlay" onclick="window.calModal.close()">
        <div class="cal-modal" onclick="event.stopPropagation()">
          <div class="cal-modal-header"><h2>New Event</h2><button class="cal-modal-close" onclick="window.calModal.close()">×</button></div>
          <div class="cal-modal-body">
            <div class="cal-modal-field"><label>Title</label><input type="text" id="calEventTitle" placeholder="Event title"></div>
            <div class="cal-modal-field"><label>Date</label><input type="date" id="calEventDate" value="${dateStr}"></div>
            <div class="cal-modal-row">
              <div class="cal-modal-field"><label>Start Time</label><input type="time" id="calEventTime" value="09:00"></div>
              <div class="cal-modal-field"><label>End Time</label><input type="time" id="calEventEndTime" value="10:00"></div>
            </div>
            <div class="cal-modal-field"><label>Description</label><textarea id="calEventDescription" rows="3" placeholder="Event description"></textarea></div>
            <div class="cal-modal-field"><label>Color</label><div class="cal-color-picker">
              ${['#6395ff','#22c55e','#f59e0b','#ef4444','#a855f7','#14b8a6'].map(c =>
                `<div class="cal-color-option" style="background:${c}" data-color="${c}" onclick="document.querySelectorAll('.cal-color-option').forEach(el=>el.classList.remove('selected')); this.classList.add('selected');"></div>`
              ).join('')}
            </div></div>
          </div>
          <div class="cal-modal-footer">
            <button class="cal-modal-btn cal-modal-cancel" onclick="window.calModal.close()">Cancel</button>
            <button class="cal-modal-btn cal-modal-save" onclick="window.calModal.saveEvent()">Create Event</button>
          </div>
        </div>
      </div>`;
    this._show(html);
  }

  openEditEvent(event) {
    const html = `
      <div class="cal-modal-overlay" id="calModalOverlay" onclick="window.calModal.close()">
        <div class="cal-modal" onclick="event.stopPropagation()">
          <div class="cal-modal-header"><h2>Edit Event</h2><button class="cal-modal-close" onclick="window.calModal.close()">×</button></div>
          <div class="cal-modal-body">
            <div class="cal-modal-field"><label>Title</label><input type="text" id="calEventTitle" value="${event.title || ''}"></div>
            <div class="cal-modal-field"><label>Date</label><input type="date" id="calEventDate" value="${event.date || ''}"></div>
            <div class="cal-modal-row">
              <div class="cal-modal-field"><label>Start Time</label><input type="time" id="calEventTime" value="${event.time || '09:00'}"></div>
              <div class="cal-modal-field"><label>End Time</label><input type="time" id="calEventEndTime" value="${event.endTime || '10:00'}"></div>
            </div>
            <div class="cal-modal-field"><label>Description</label><textarea id="calEventDescription" rows="3">${event.description || ''}</textarea></div>
            <div class="cal-modal-field"><label>Color</label><div class="cal-color-picker">
              ${['#6395ff','#22c55e','#f59e0b','#ef4444','#a855f7','#14b8a6'].map(c =>
                `<div class="cal-color-option ${c === (event.color || '#6395ff') ? 'selected' : ''}" style="background:${c}" data-color="${c}" onclick="document.querySelectorAll('.cal-color-option').forEach(el=>el.classList.remove('selected')); this.classList.add('selected');"></div>`
              ).join('')}
            </div></div>
          </div>
          <div class="cal-modal-footer">
            <button class="cal-modal-btn cal-modal-delete" onclick="window.calModal.deleteEvent('${event.id}')">Delete</button>
            <button class="cal-modal-btn cal-modal-cancel" onclick="window.calModal.close()">Cancel</button>
            <button class="cal-modal-btn cal-modal-save" onclick="window.calModal.saveEdit('${event.id}')">Save</button>
          </div>
        </div>
      </div>`;
    this._show(html);
  }

  _show(html) {
    this.close();
    const div = document.createElement('div');
    div.innerHTML = html;
    document.body.appendChild(div.firstElementChild);
    const opts = document.querySelectorAll('.cal-color-option');
    if (opts.length > 0 && !document.querySelector('.cal-color-option.selected')) opts[0].classList.add('selected');
  }

  close() { const o = document.getElementById('calModalOverlay'); if (o) o.remove(); }

  _getFormData() {
    const title = document.getElementById('calEventTitle')?.value;
    const date = document.getElementById('calEventDate')?.value;
    if (!title || !date) { alert('Title and date are required'); return null; }
    const time = document.getElementById('calEventTime')?.value || null;
    const endTime = document.getElementById('calEventEndTime')?.value || null;
    const description = document.getElementById('calEventDescription')?.value || '';
    const selectedColor = document.querySelector('.cal-color-option.selected');
    const color = selectedColor ? selectedColor.dataset.color : '#6395ff';
    return { title, date, time, endTime, description, color };
  }

  saveEvent() {
    const data = this._getFormData();
    if (!data) return;
    window.calData.createEvent(data).then(() => { window.calModal.close(); window.refreshCalendar(); });
  }

  saveEdit(id) {
    const data = this._getFormData();
    if (!data) return;
    window.calData.updateEvent(id, data).then(() => { window.calModal.close(); window.refreshCalendar(); });
  }

  deleteEvent(id) {
    if (!confirm('Delete this event?')) return;
    window.calData.deleteEvent(id).then(() => { window.calModal.close(); window.refreshCalendar(); });
  }
}

// ================================================================
// Initialize — Single source of truth: AppStore
// ================================================================
const calState = new CalendarState();
const calRenderer = new CalendarRenderer(calState);
const calData = new CalendarData();
const calModal = new CalendarModal();

window.calState = calState;
window.calRenderer = calRenderer;
window.calData = calData;
window.calModal = calModal;

window.openEventModal = function() { calModal.openCreateEvent(calState.selectedDate || new Date()); };

// Build events from AppStore leads + API events
function syncCalendarFromAppStore() {
  const allLeads = (typeof window.AppStore !== 'undefined' && window.AppStore.getLeads) ? window.AppStore.getLeads() : (window.__leads || []);
  const leadEvents = allLeads
    .filter(l => l.status === 'booked' || l.status === 'appointment-set' || l.outcome === 'appointment-set')
    .map(l => ({
      id: 'lead-' + l.id,
      title: l.caller_name || l.caller || 'Appointment',
      date: l.appointment_date || l.date || l.createdAt ? (l.createdAt || '').split('T')[0] : '',
      time: l.appointment_time || l.time || '09:00',
      type: 'lead',
      leadId: l.id,
      phone: l.phone || '',
      address: l.address || '',
      serviceType: l.service_type || l.service || '',
      estimatedPrice: parseFloat(l.avgPrice || l.estimated_price) || 0,
      color: '#6395ff'
    }));
  return leadEvents;
}

window.refreshCalendar = async function() {
  try {
    const [apiEvents, leadEvents] = await Promise.all([
      calData.fetchEvents().catch(() => []),
      Promise.resolve(syncCalendarFromAppStore())
    ]);
    // Merge: API events + lead events from AppStore (no duplicates)
    const existingIds = new Set(apiEvents.map(e => e.id));
    const newLeadEvents = leadEvents.filter(e => !existingIds.has(e.id));
    calState.events = [...apiEvents, ...newLeadEvents];
  } catch(e) {
    calState.events = syncCalendarFromAppStore();
  }
  calRenderer.render();
};

// Handle event selection
calState.onChange((state) => {
  calRenderer.render();
  if (state.selectedEvent) {
    const event = state.selectedEvent;
    if (event.type === 'lead' && window.CustomerDrawer) {
      const lead = { id: event.leadId, caller_name: event.title, phone: event.phone, address: event.address, service_type: event.serviceType, estimated_price: event.estimatedPrice };
      window.CustomerDrawer.open(lead);
    }
  }
});
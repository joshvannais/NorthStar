/**
 * NorthStar Calendar Engine
 * 
 * Phase 1 — Dispatch-ready calendar architecture with pluggable view renderers.
 * Event interface: { id, title, date, time, endTime, description, color, type, leadId, ... }
 * 
 * This is the foundation for NorthStar's operational dispatch center.
 * Future phases will add:
 * - Drag-and-drop scheduling (Phase 2)
 * - Technician management (Phase 2)
 * - Route optimization (Phase 3)
 * - Weather awareness (Phase 3)
 * - Polaris job intelligence (Phase 3)
 * - Automated reminders (Phase 3)
 * 
 * Architecture: CalendarState, CalendarRenderer, CalendarData, CalendarModal
 * All new features should slot into this architecture without rewrites.
 */

// ================================================================
// CalendarState
// ================================================================
class CalendarState {
  constructor() {
    this.view = 'month'; // 'month' | 'week' | 'day' | 'agenda'
    this.currentDate = new Date();
    this.events = [];
    this.selectedDate = null;
    this.selectedEvent = null;
    this.listeners = [];
  }

  get year() { return this.currentDate.getFullYear(); }
  get month() { return this.currentDate.getMonth(); }

  getMonthStart() {
    return new Date(this.year, this.month, 1);
  }

  getMonthEnd() {
    return new Date(this.year, this.month + 1, 0);
  }

  getDaysInMonth() {
    return new Date(this.year, this.month + 1, 0).getDate();
  }

  getFirstDayOfMonth() {
    return this.getMonthStart().getDay();
  }

  getMonthLabel() {
    const months = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'
    ];
    return months[this.month] + ' ' + this.year;
  }

  getWeekStart() {
    const d = new Date(this.currentDate);
    const day = d.getDay();
    d.setDate(d.getDate() - day);
    return d;
  }

  getWeekDays() {
    const start = this.getWeekStart();
    const days = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(start);
      d.setDate(d.getDate() + i);
      days.push(d);
    }
    return days;
  }

  getEventsForDate(date) {
    const dateStr = this._formatDate(date);
    return this.events.filter(e => e.date === dateStr);
  }

  getEventsForMonth() {
    const start = this._formatDate(this.getMonthStart());
    const end = this._formatDate(this.getMonthEnd());
    return this.events.filter(e => e.date >= start && e.date <= end);
  }

  getEventsForWeek() {
    const days = this.getWeekDays();
    const start = this._formatDate(days[0]);
    const end = this._formatDate(days[6]);
    return this.events.filter(e => e.date >= start && e.date <= end);
  }

  navigate(delta) {
    if (this.view === 'month') {
      this.currentDate.setMonth(this.currentDate.getMonth() + delta);
    } else if (this.view === 'week' || this.view === 'day') {
      this.currentDate.setDate(this.currentDate.getDate() + (delta * 7));
    }
    this._notify();
  }

  goToday() {
    this.currentDate = new Date();
    this.selectedDate = null;
    this.selectedEvent = null;
    this._notify();
  }

  setView(view) {
    this.view = view;
    this.selectedEvent = null;
    this._notify();
  }

  selectDate(date) {
    this.selectedDate = date;
    this.selectedEvent = null;
    this._notify();
  }

  selectEvent(event) {
    this.selectedEvent = event;
    this._notify();
  }

  onChange(fn) {
    this.listeners.push(fn);
  }

  _notify() {
    this.listeners.forEach(fn => fn(this));
  }

  _formatDate(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  isToday(date) {
    const today = new Date();
    return this._formatDate(date) === this._formatDate(today);
  }

  isSelected(date) {
    if (!this.selectedDate) return false;
    return this._formatDate(date) === this._formatDate(this.selectedDate);
  }
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
  }

  renderHeader() {
    if (!this.header) return;
    this.header.innerHTML = `
      <div class="cal-header-left">
        <h1 class="cal-title">${this.state.getMonthLabel()}</h1>
        <div class="cal-nav-btns">
          <button class="cal-nav-btn" onclick="window.calState.navigate(-1)" title="Previous">‹</button>
          <button class="cal-nav-btn" onclick="window.calState.navigate(1)" title="Next">›</button>
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
      </div>
    `;
  }

  renderKpiBar() {
    if (!this.kpiBar) return;
    const monthEvents = this.state.getEventsForMonth();
    const today = new Date();
    const todayStr = this.state._formatDate(today);
    const todayEvents = this.state.events.filter(e => e.date === todayStr);
    const leadEvents = this.state.events.filter(e => e.type === 'lead');
    const total = this.state.events.length;
    const pipelineValue = leadEvents.reduce((sum, e) => sum + (parseFloat(e.estimatedPrice) || 0), 0);

    this.kpiBar.innerHTML = `
      <span class="cal-kpi-pill">📅 <strong>${monthEvents.length}</strong> appointments this month</span>
      <span class="cal-kpi-divider"></span>
      <span class="cal-kpi-pill">📞 <strong>${todayEvents.length}</strong> today</span>
      <span class="cal-kpi-divider"></span>
      <span class="cal-kpi-pill">📊 <strong>${total}</strong> total events</span>
      <span class="cal-kpi-divider"></span>
      <span class="cal-kpi-pill">💰 <strong>${pipelineValue.toLocaleString()}</strong> pipeline</span>
    `;
  }

  renderMonth() {
    if (!this.container) return;
    const daysInMonth = this.state.getDaysInMonth();
    const firstDay = this.state.getFirstDayOfMonth();
    const monthEvents = this.state.getEventsForMonth();

    let html = '<div class="cal-month-grid">';
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    dayNames.forEach(d => {
      html += `<div class="cal-month-day-header">${d}</div>`;
    });

    for (let i = 0; i < firstDay; i++) {
      html += '<div class="cal-month-cell cal-month-cell-empty"></div>';
    }

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
          html += `<div class="cal-month-event-dot" style="background:${e.color || '#3b82f6'}" title="${e.title || 'Event'}"></div>`;
        });
        if (dayEvents.length > 3) {
          html += `<span class="cal-month-event-more">+${dayEvents.length - 3} more</span>`;
        }
        html += '</div>';
      }
      html += '</div>';
    }

    html += '</div>';

    html += this._renderScheduleSection();
    html += this._renderPolarisSection();
    html += this._renderActions();
    this.container.innerHTML = html;
  }

  renderWeek() {
    if (!this.container) return;
    const days = this.state.getWeekDays();
    const weekEvents = this.state.getEventsForWeek();

    let html = '<div class="cal-week-grid">';
    html += '<div class="cal-week-row cal-week-header">';
    html += '<div class="cal-week-time-header"></div>';
    days.forEach(d => {
      const dayName = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d.getDay()];
      const dayNum = d.getDate();
      const isToday = this.state.isToday(d);
      html += `<div class="cal-week-day-header ${isToday ? 'cal-week-day-header-today' : ''}">${dayName} ${dayNum}</div>`;
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
          html += `<div class="cal-week-event" style="background:${e.color || '#3b82f6'}" onclick="event.stopPropagation(); window.calState.selectEvent(window.calState.events.find(ev => ev.id === '${e.id}'))">${e.title}</div>`;
        });
        html += '</div>';
      });
      html += '</div>';
    }
    html += '</div>';

    html += this._renderScheduleSection();
    html += this._renderPolarisSection();
    html += this._renderActions();
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
      const timeStr = String(hour).padStart(2, '0');
      const hourEvents = dayEvents.filter(e => e.time && e.time.startsWith(timeStr));
      html += '<div class="cal-day-row">';
      html += `<div class="cal-day-time">${hour === 0 ? '12 AM' : hour < 12 ? hour + ' AM' : hour === 12 ? '12 PM' : (hour - 12) + ' PM'}</div>`;
      html += '<div class="cal-day-content">';
      hourEvents.forEach(e => {
        html += `<div class="cal-day-event-card" style="border-left: 3px solid ${e.color || '#3b82f6'}" onclick="window.calState.selectEvent(window.calState.events.find(ev => ev.id === '${e.id}'))">`;
        html += `<div class="cal-day-event-time">${e.time || ''}</div>`;
        html += `<div class="cal-day-event-title">${e.title}</div>`;
        if (e.description) html += `<div class="cal-day-event-desc">${e.description}</div>`;
        html += '</div>';
      });
      html += '</div></div>';
    }
    html += '</div>';

    html += this._renderScheduleSection();
    html += this._renderPolarisSection();
    html += this._renderActions();
    this.container.innerHTML = html;
  }

  renderAgenda() {
    if (!this.container) return;
    const sorted = [...this.state.events].sort((a, b) => {
      if (a.date < b.date) return -1;
      if (a.date > b.date) return 1;
      if (a.time && b.time) return a.time.localeCompare(b.time);
      return 0;
    });

    let html = '<div class="cal-agenda-view">';
    if (sorted.length === 0) {
      const allLeads = (typeof window.AppStore !== 'undefined' && window.AppStore.getLeads) ? window.AppStore.getLeads() : [];
      const hasLeads = allLeads.length > 0;
      html += '<div class="cal-agenda-empty">';
      html += '<div style="font-size:36px;margin-bottom:var(--space-md);">📅</div>';
      html += '<div style="font-size:var(--font-md);font-weight:600;color:var(--neutral-700);margin-bottom:var(--space-sm);">No events scheduled</div>';
      if (hasLeads) {
        html += '<div style="font-size:var(--font-sm);color:var(--neutral-500);">You have leads ready to schedule.</div>';
      } else {
        html += '<div style="font-size:var(--font-sm);color:var(--neutral-500);margin-bottom:var(--space-sm);">Receive calls to auto-schedule appointments.</div>';
        if (typeof window.genCall === 'function') {
          html += '<button onclick="window.genCall();setTimeout(()=>window.refreshCalendar(),1500)" style="margin-top:var(--space-sm);padding:var(--space-sm) var(--space-lg);background:var(--brand-500);color:white;border:none;border-radius:var(--radius-sm);font-size:var(--font-sm);font-weight:600;cursor:pointer;">📞 Simulate a lead</button>';
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
        html += `<div class="cal-agenda-event-color" style="background:${e.color || '#3b82f6'}"></div>`;
        html += `<div class="cal-agenda-event-info">`;
        html += `<div class="cal-agenda-event-title">${e.title}</div>`;
        if (e.time) html += `<div class="cal-agenda-event-time">${e.time}</div>`;
        if (e.description) html += `<div class="cal-agenda-event-desc">${e.description}</div>`;
        html += `</div></div>`;
      });
      html += '</div></div>';
    }
    html += '</div>';

    html += this._renderPolarisSection();
    html += this._renderActions();
    this.container.innerHTML = html;
  }

  // === Shared Sections ===

  _renderScheduleSection() {
    const selectedDate = this.state.selectedDate || new Date();
    const selectedStr = this.state._formatDate(selectedDate);
    const dayEvents = this.state.events.filter(e => e.date === selectedStr);
    const dateLabel = selectedDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
    const isSelectedToday = this.state._formatDate(new Date()) === selectedStr;

    let html = '<div class="cal-schedule-section">';
    html += `<div class="cal-schedule-header">`;
    html += `<h2 class="cal-schedule-title">${dateLabel}${isSelectedToday ? ' — Today' : ''}</h2>`;
    html += `<span class="cal-schedule-count">${dayEvents.length} event${dayEvents.length !== 1 ? 's' : ''}</span>`;
    html += `</div>`;
    html += '<div class="cal-schedule-list">';

    if (dayEvents.length === 0) {
      const allLeads = (typeof window.AppStore !== 'undefined' && window.AppStore.getLeads) ? window.AppStore.getLeads() : [];
      html += '<div class="cal-schedule-empty">';
      html += '<div class="cal-schedule-empty-icon">📅</div>';
      if (allLeads.length > 0) {
        html += '<div>No events on this day. Click a day with events to see the schedule.</div>';
      } else {
        html += '<div>No events scheduled. Click a day to create an event.</div>';
        if (typeof window.genCall === 'function') {
          html += '<button onclick="window.genCall();setTimeout(()=>window.refreshCalendar(),1500)" style="margin-top:var(--space-sm);padding:var(--space-sm) var(--space-lg);background:var(--brand-500);color:white;border:none;border-radius:var(--radius-sm);font-size:var(--font-sm);font-weight:600;cursor:pointer;">📞 Simulate a lead</button>';
        }
      }
      html += '</div>';
    } else {
      dayEvents.forEach(e => {
        html += `<div class="cal-schedule-card" onclick="window.calState.selectEvent(window.calState.events.find(ev => ev.id === '${e.id}'))">`;
        html += `<div class="cal-schedule-card-color" style="background:${e.color || '#3b82f6'}"></div>`;
        html += `<div class="cal-schedule-card-body">`;
        html += `<div class="cal-schedule-card-title">${e.title}</div>`;
        html += `<div class="cal-schedule-card-meta">`;
        if (e.time) html += `<span class="cal-schedule-card-meta-item">🕐 ${e.time}</span>`;
        if (e.type === 'lead') html += `<span class="cal-schedule-card-meta-item">📞 Lead</span>`;
        if (e.description) html += `<span class="cal-schedule-card-meta-item">${e.description}</span>`;
        if (e.caller) html += `<span class="cal-schedule-card-meta-item">👤 ${e.caller}</span>`;
        if (e.price) html += `<span class="cal-schedule-card-meta-item">💰 ${parseFloat(e.price).toLocaleString()}</span>`;
        html += `</div></div></div>`;
      });
    }
    html += '</div></div>';
    return html;
  }

  _renderPolarisSection() {
    const selectedDate = this.state.selectedDate || new Date();
    const selectedStr = this.state._formatDate(selectedDate);
    const dayEvents = this.state.events.filter(e => e.date === selectedStr);
    const leadEvents = this.state.events.filter(e => e.type === 'lead' && e.date === selectedStr);
    const allLeads = (typeof window.AppStore !== 'undefined' && window.AppStore.getLeads) ? window.AppStore.getLeads() : [];
    const unscheduledLeads = allLeads.filter(l => l.outcome !== 'appointment-set' && l.status !== 'booked' && l.status !== 'estimate-scheduled');
    const totalPipeline = allLeads.reduce((sum, l) => sum + (parseFloat(l.estimated_price) || 0), 0);
    const topLead = allLeads.length > 0 ? allLeads.sort((a,b) => (parseFloat(b.estimated_price)||0) - (parseFloat(a.estimated_price)||0))[0] : null;
    const dayPipeline = leadEvents.reduce((sum, e) => sum + (parseFloat(e.price) || 0), 0);

    let html = '<div class="cal-polaris-section">';
    html += '<div class="cal-polaris-header">';
    html += '<h3 class="cal-polaris-title">POLARIS™ Intelligence</h3>';
    html += '<span class="cal-polaris-badge">✦ Day Analysis</span>';
    html += '</div>';

    if (dayEvents.length > 0) {
      html += '<div class="cal-polaris-grid">';
      const topOpp = leadEvents.length > 0 ? leadEvents[0].title : dayEvents[0].title;
      html += `<div class="cal-polaris-item"><span class="cal-polaris-label">📊 Appointments</span><span class="cal-polaris-value">${dayEvents.length}</span></div>`;
      if (dayPipeline > 0) html += `<div class="cal-polaris-item"><span class="cal-polaris-label">💰 Day Revenue</span><span class="cal-polaris-value">${dayPipeline.toLocaleString()}</span></div>`;
      html += `<div class="cal-polaris-item"><span class="cal-polaris-label">🎯 Top Priority</span><span class="cal-polaris-value" style="font-size:var(--font-xs);">${topOpp}</span></div>`;
      if (totalPipeline > 0) html += `<div class="cal-polaris-item"><span class="cal-polaris-label">📈 Pipeline</span><span class="cal-polaris-value">${totalPipeline.toLocaleString()}</span></div>`;
      html += '</div>';
    } else if (unscheduledLeads.length > 0) {
      html += '<div class="cal-polaris-grid">';
      html += `<div class="cal-polaris-item"><span class="cal-polaris-label">📋 Unscheduled</span><span class="cal-polaris-value">${unscheduledLeads.length}</span></div>`;
      if (totalPipeline > 0) html += `<div class="cal-polaris-item"><span class="cal-polaris-label">💰 Est. Pipeline</span><span class="cal-polaris-value">${totalPipeline.toLocaleString()}</span></div>`;
      if (topLead) {
        const topOpp = `${topLead.caller_name || 'Lead'} — ${(parseFloat(topLead.estimated_price)||0).toLocaleString()}`;
        html += `<div class="cal-polaris-item"><span class="cal-polaris-label">👤 Top Opportunity</span><span class="cal-polaris-value" style="font-size:var(--font-xs);">${topOpp}</span></div>`;
      }
      html += `<div class="cal-polaris-item"><span class="cal-polaris-label">📅 Action</span><span class="cal-polaris-value" style="font-size:var(--font-xs);">Schedule pending leads</span></div>`;
      html += '</div>';
    } else {
      html += '<div class="cal-polaris-empty">';
      html += '<div style="font-size:24px;margin-bottom:var(--space-sm);">📅</div>';
      html += '<div>Welcome to NorthStar Calendar. Schedule appointments to see Polaris insights.</div>';
      if (typeof window.genCall === 'function') {
        html += '<button onclick="window.genCall();setTimeout(()=>window.refreshCalendar(),1500)" style="margin-top:var(--space-sm);padding:var(--space-sm) 16px;background:var(--brand-500);color:white;border:none;border-radius:var(--radius-sm);font-size:var(--font-xs);font-weight:600;cursor:pointer;">📞 Simulate a lead</button>';
      }
      html += '</div>';
    }

    html += '</div>';
    return html;
  }

  _renderActions() {
    return '<div class="cal-actions"><button class="cal-new-event-btn" onclick="window.openEventModal()">+ New Event</button></div>';
  }

  renderSidebar() {
    // Sidebar removed — all content moved to main flow
  }
}

// ================================================================
// CalendarData — API calls
// ================================================================
class CalendarData {
  constructor() {
    this.baseUrl = '/api/v1/calendar';
  }

  async fetchEvents() {
    try {
      // Fetch from server API (custom events + server-side lead events)
      const resp = await fetch(`${this.baseUrl}/events`);
      const data = await resp.json();
      let events = data.events || [];

      // Also include client-side AppStore leads (simulated data)
      const allLeads = (typeof window.AppStore !== 'undefined' && window.AppStore.getLeads) ? window.AppStore.getLeads() : [];
      const appStoreLeadEvents = allLeads
        .filter(l => l.outcome === 'appointment-set' || l.outcome === 'booked' || l.status === 'booked')
        .filter(l => !events.some(e => e.leadId === l.id)) // deduplicate with server events
        .map(l => ({
          id: 'lead-' + l.id,
          title: l.caller + ' - ' + l.service,
          date: l.receivedAt ? l.receivedAt.split('T')[0] : new Date().toISOString().split('T')[0],
          time: l.time || '09:00',
          endTime: null,
          description: l.summary || '',
          color: '#007AFF',
          type: 'lead',
          leadId: l.id,
          caller: l.caller,
          phone: l.phone,
          service: l.service,
          price: l.avgPrice || 0,
          createdAt: l.receivedAt || new Date().toISOString()
        }));

      events = [...events, ...appStoreLeadEvents];
      return events;
    } catch (e) {
      console.warn('[CalendarData] fetchEvents error:', e.message);
      return [];
    }
  }

  async createEvent(data) {
    try {
      const resp = await fetch(`${this.baseUrl}/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      const result = await resp.json();
      return result.event;
    } catch (e) {
      console.warn('[CalendarData] createEvent error:', e.message);
      return null;
    }
  }

  async updateEvent(id, data) {
    try {
      const resp = await fetch(`${this.baseUrl}/events/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      const result = await resp.json();
      return result.event;
    } catch (e) {
      console.warn('[CalendarData] updateEvent error:', e.message);
      return null;
    }
  }

  async deleteEvent(id) {
    try {
      const resp = await fetch(`${this.baseUrl}/events/${id}`, {
        method: 'DELETE'
      });
      return resp.ok;
    } catch (e) {
      console.warn('[CalendarData] deleteEvent error:', e.message);
      return false;
    }
  }

  async exportICS() {
    try {
      const resp = await fetch(`${this.baseUrl}/export/ics`);
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'calendar.ics';
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.warn('[CalendarData] exportICS error:', e.message);
    }
  }

  async importICS(icsContent) {
    try {
      const resp = await fetch(`${this.baseUrl}/import/ics`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ icsContent })
      });
      const result = await resp.json();
      return result;
    } catch (e) {
      console.warn('[CalendarData] importICS error:', e.message);
      return null;
    }
  }
}

// ================================================================
// Calendar Event Modal
// ================================================================
class CalendarModal {
  constructor() {
    this.overlay = null;
    this.modal = null;
  }

  openCreateEvent(date) {
    const dateStr = date ? this._formatDate(date) : new Date().toISOString().split('T')[0];
    const html = `
      <div class="cal-modal-overlay" id="calModalOverlay" onclick="window.calModal.close()">
        <div class="cal-modal" onclick="event.stopPropagation()">
          <div class="cal-modal-header">
            <h2>New Event</h2>
            <button class="cal-modal-close" onclick="window.calModal.close()">×</button>
          </div>
          <div class="cal-modal-body">
            <div class="cal-modal-field">
              <label>Title</label>
              <input type="text" id="calEventTitle" placeholder="Event title" value="">
            </div>
            <div class="cal-modal-field">
              <label>Date</label>
              <input type="date" id="calEventDate" value="${dateStr}">
            </div>
            <div class="cal-modal-row">
              <div class="cal-modal-field">
                <label>Start Time</label>
                <input type="time" id="calEventTime" value="09:00">
              </div>
              <div class="cal-modal-field">
                <label>End Time</label>
                <input type="time" id="calEventEndTime" value="10:00">
              </div>
            </div>
            <div class="cal-modal-field">
              <label>Description</label>
              <textarea id="calEventDescription" rows="3" placeholder="Event description"></textarea>
            </div>
            <div class="cal-modal-field">
              <label>Color</label>
              <div class="cal-color-picker">
                ${['#3b82f6','#22c55e','#f59e0b','#ef4444','#a855f7','#14b8a6'].map(c =>
                  `<div class="cal-color-option" style="background:${c}" data-color="${c}" onclick="document.querySelectorAll('.cal-color-option').forEach(el=>el.classList.remove('selected')); this.classList.add('selected');"></div>`
                ).join('')}
              </div>
            </div>
          </div>
          <div class="cal-modal-footer">
            <button class="cal-modal-btn cal-modal-cancel" onclick="window.calModal.close()">Cancel</button>
            <button class="cal-modal-btn cal-modal-save" onclick="window.calModal.saveEvent()">Create Event</button>
          </div>
        </div>
      </div>
    `;
    this._show(html);
  }

  openEditEvent(event) {
    const html = `
      <div class="cal-modal-overlay" id="calModalOverlay" onclick="window.calModal.close()">
        <div class="cal-modal" onclick="event.stopPropagation()">
          <div class="cal-modal-header">
            <h2>Edit Event</h2>
            <button class="cal-modal-close" onclick="window.calModal.close()">×</button>
          </div>
          <div class="cal-modal-body">
            <div class="cal-modal-field">
              <label>Title</label>
              <input type="text" id="calEventTitle" value="${event.title || ''}">
            </div>
            <div class="cal-modal-field">
              <label>Date</label>
              <input type="date" id="calEventDate" value="${event.date || ''}">
            </div>
            <div class="cal-modal-row">
              <div class="cal-modal-field">
                <label>Start Time</label>
                <input type="time" id="calEventTime" value="${event.time || '09:00'}">
              </div>
              <div class="cal-modal-field">
                <label>End Time</label>
                <input type="time" id="calEventEndTime" value="${event.endTime || '10:00'}">
              </div>
            </div>
            <div class="cal-modal-field">
              <label>Description</label>
              <textarea id="calEventDescription" rows="3">${event.description || ''}</textarea>
            </div>
            <div class="cal-modal-field">
              <label>Color</label>
              <div class="cal-color-picker">
                ${['#3b82f6','#22c55e','#f59e0b','#ef4444','#a855f7','#14b8a6'].map(c =>
                  `<div class="cal-color-option ${c === (event.color || '#3b82f6') ? 'selected' : ''}" style="background:${c}" data-color="${c}" onclick="document.querySelectorAll('.cal-color-option').forEach(el=>el.classList.remove('selected')); this.classList.add('selected');"></div>`
                ).join('')}
              </div>
            </div>
          </div>
          <div class="cal-modal-footer">
            <button class="cal-modal-btn cal-modal-delete" onclick="window.calModal.deleteEvent('${event.id}')">Delete</button>
            <button class="cal-modal-btn cal-modal-cancel" onclick="window.calModal.close()">Cancel</button>
            <button class="cal-modal-btn cal-modal-save" onclick="window.calModal.saveEdit('${event.id}')">Save</button>
          </div>
        </div>
      </div>
    `;
    this._show(html);
  }

  _show(html) {
    this.close();
    const div = document.createElement('div');
    div.innerHTML = html;
    document.body.appendChild(div.firstElementChild);
    const colorOptions = document.querySelectorAll('.cal-color-option');
    if (colorOptions.length > 0 && !document.querySelector('.cal-color-option.selected')) {
      colorOptions[0].classList.add('selected');
    }
  }

  close() {
    const overlay = document.getElementById('calModalOverlay');
    if (overlay) overlay.remove();
  }

  saveEvent() {
    const title = document.getElementById('calEventTitle')?.value;
    const date = document.getElementById('calEventDate')?.value;
    if (!title || !date) { alert('Title and date are required'); return; }
    const time = document.getElementById('calEventTime')?.value || null;
    const endTime = document.getElementById('calEventEndTime')?.value || null;
    const description = document.getElementById('calEventDescription')?.value || '';
    const selectedColor = document.querySelector('.cal-color-option.selected');
    const color = selectedColor ? selectedColor.dataset.color : '#3b82f6';

    window.calData.createEvent({ title, date, time, endTime, description, color }).then(() => {
      window.calModal.close();
      window.refreshCalendar();
    });
  }

  saveEdit(id) {
    const title = document.getElementById('calEventTitle')?.value;
    const date = document.getElementById('calEventDate')?.value;
    if (!title || !date) { alert('Title and date are required'); return; }
    const time = document.getElementById('calEventTime')?.value || null;
    const endTime = document.getElementById('calEventEndTime')?.value || null;
    const description = document.getElementById('calEventDescription')?.value || '';
    const selectedColor = document.querySelector('.cal-color-option.selected');
    const color = selectedColor ? selectedColor.dataset.color : '#3b82f6';

    window.calData.updateEvent(id, { title, date, time, endTime, description, color }).then(() => {
      window.calModal.close();
      window.refreshCalendar();
    });
  }

  deleteEvent(id) {
    if (!confirm('Delete this event?')) return;
    window.calData.deleteEvent(id).then(() => {
      window.calModal.close();
      window.refreshCalendar();
    });
  }

  _formatDate(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
}

// ================================================================
// CalendarEventDetail — Accordion panel for dispatch center vision
// ================================================================
class CalendarEventDetail {
  constructor() {
    this.panel = null;
  }

  open(event) {
    this.close();
    const overlay = document.createElement('div');
    overlay.className = 'cal-modal-overlay';
    overlay.onclick = () => this.close();
    overlay.innerHTML = `
      <div class="cal-modal" onclick="event.stopPropagation()" style="width:520px;">
        <div class="cal-modal-header">
          <h2>${event.title || 'Event Details'}</h2>
          <button class="cal-modal-close" onclick="window.calEventDetail.close()">×</button>
        </div>
        <div class="cal-modal-body" style="max-height:60vh;overflow-y:auto;">
          ${this._renderCustomerSection(event)}
          ${this._renderServiceSection(event)}
          ${this._renderCrewSection(event)}
          ${this._renderFinancialsSection(event)}
          ${this._renderPolarisSection(event)}
          ${this._renderWeatherSection(event)}
          ${this._renderNotesSection(event)}
        </div>
        <div class="cal-modal-footer">
          <button class="cal-modal-btn cal-modal-cancel" onclick="window.calEventDetail.close()">Close</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    this.panel = overlay;
  }

  close() {
    if (this.panel) { this.panel.remove(); this.panel = null; }
  }

  _renderSection(emoji, title, content, isFuture = false) {
    const futureTag = isFuture ? ' <span style="font-size:10px;color:var(--neutral-400);font-weight:400;">— Phase 2</span>' : '';
    return `
      <div class="cal-detail-section" onclick="this.classList.toggle('collapsed')">
        <div class="cal-detail-section-header">
          <span>${emoji} ${title}${futureTag}</span>
          <span class="cal-detail-toggle">▼</span>
        </div>
        <div class="cal-detail-section-body">${content}</div>
      </div>
    `;
  }

  _renderCustomerSection(event) {
    return this._renderSection('👤', 'Customer Information', `
      <div class="cal-detail-row"><span class="cal-detail-label">Name</span><span>${event.title || '—'}</span></div>
      <div class="cal-detail-row"><span class="cal-detail-label">Phone</span><span>${event.phone || '—'}</span></div>
      <div class="cal-detail-row"><span class="cal-detail-label">Address</span><span>${event.address || '—'}</span></div>
    `);
  }

  _renderServiceSection(event) {
    const desc = event.description || event.serviceType || '—';
    const duration = event.polaris?.estimatedDuration || '—';
    return this._renderSection('🔧', 'Service Details', `
      <div class="cal-detail-row"><span class="cal-detail-label">Service</span><span>${event.serviceType || '—'}</span></div>
      <div class="cal-detail-row"><span class="cal-detail-label">Description</span><span>${desc}</span></div>
      <div class="cal-detail-row"><span class="cal-detail-label">Est. Duration</span><span>${duration === '—' ? '— Available in Phase 2' : duration + ' min'}</span></div>
    `);
  }

  _renderCrewSection(event) {
    return this._renderSection('👥', 'Crew Assignment', `
      <div class="cal-detail-row"><span class="cal-detail-label">Technician</span><span style="color:var(--neutral-400);font-style:italic;">— Crew assignment available in Phase 2</span></div>
      <div class="cal-detail-row"><span class="cal-detail-label">Equipment</span><span style="color:var(--neutral-400);font-style:italic;">— Equipment tracking available in Phase 2</span></div>
    `, true);
  }

  _renderFinancialsSection(event) {
    const price = event.estimatedPrice || event.price || 0;
    const margin = price > 0 ? '35%' : '—';
    return this._renderSection('💰', 'Financials', `
      <div class="cal-detail-row"><span class="cal-detail-label">Est. Cost</span><span>${parseFloat(price).toLocaleString()}</span></div>
      <div class="cal-detail-row"><span class="cal-detail-label">Suggested Bid</span><span style="color:var(--neutral-400);font-style:italic;">— Available in Phase 3</span></div>
      <div class="cal-detail-row"><span class="cal-detail-label">Gross Profit</span><span style="color:var(--neutral-400);font-style:italic;">— Available in Phase 3</span></div>
      <div class="cal-detail-row"><span class="cal-detail-label">Margin</span><span>${margin}</span></div>
    `);
  }

  _renderPolarisSection(event) {
    return this._renderSection('📊', 'Polaris Intelligence', `
      <div class="cal-detail-row"><span class="cal-detail-label">Confidence Score</span><span style="color:var(--neutral-400);font-style:italic;">— Available in Phase 3</span></div>
      <div class="cal-detail-row"><span class="cal-detail-label">Recommendations</span><span style="color:var(--neutral-400);font-style:italic;">— Available in Phase 3</span></div>
    `, true);
  }

  _renderWeatherSection(event) {
    return this._renderSection('🌤', 'Weather', `
      <div class="cal-detail-row"><span class="cal-detail-label">Conditions</span><span style="color:var(--neutral-400);font-style:italic;">— Weather awareness available in Phase 3</span></div>
      <div class="cal-detail-row"><span class="cal-detail-label">Alerts</span><span style="color:var(--neutral-400);font-style:italic;">— Weather awareness available in Phase 3</span></div>
    `, true);
  }

  _renderNotesSection(event) {
    return this._renderSection('📝', 'Notes & History', `
      <div class="cal-detail-row"><span class="cal-detail-label">Notes</span><span style="color:var(--neutral-400);font-style:italic;">— Notes available in Phase 2</span></div>
      <div class="cal-detail-row"><span class="cal-detail-label">History</span><span style="color:var(--neutral-400);font-style:italic;">— Communication history available in Phase 2</span></div>
    `, true);
  }
}

// ================================================================
// Initialize
// ================================================================
const calState = new CalendarState();
const calRenderer = new CalendarRenderer(calState);
const calData = new CalendarData();
const calModal = new CalendarModal();
const calEventDetail = new CalendarEventDetail();

// Expose globals
window.calState = calState;
window.calRenderer = calRenderer;
window.calData = calData;
window.calModal = calModal;
window.calEventDetail = calEventDetail;

// Open event modal for selected date
window.openEventModal = function() {
  const date = calState.selectedDate || new Date();
  calModal.openCreateEvent(date);
};

// Refresh calendar
window.refreshCalendar = async function() {
  const events = await calData.fetchEvents();
  calState.events = events;
  calRenderer.render();
};

// Handle event selection
calState.onChange((state) => {
  calRenderer.render();
  if (state.selectedEvent) {
    const event = state.selectedEvent;
    // If lead event, open Customer Drawer (existing pattern)
    if (event.type === 'lead' && window.CustomerDrawer) {
      const lead = {
        id: event.leadId,
        caller_name: event.title,
        phone: event.phone,
        address: event.address,
        service_type: event.serviceType,
        estimated_price: event.estimatedPrice
      };
      window.CustomerDrawer.open(lead);
    } else if (event.type === 'custom' || !event.type) {
      // For custom events, open the CalendarEventDetail accordion panel
      calEventDetail.open(event);
    }
  }
});
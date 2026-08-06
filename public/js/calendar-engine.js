/**
 * NorthStar Calendar Engine — Mockup-matched implementation
 * One calendar, one event list, one Polaris intelligence section.
 * Single source of truth: AppStore (shared with Dashboard).
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

  _formatDate(date) { const y=date.getFullYear(); const m=String(date.getMonth()+1).padStart(2,'0'); const d=String(date.getDate()).padStart(2,'0'); return y+'-'+m+'-'+d; }

  getEventsForMonth() {
    return this.events.filter(e => {
      if (!e.date) return false;
      const d = new Date(e.date);
      return d.getMonth() === this.month && d.getFullYear() === this.year;
    });
  }

  getTodayEvents() {
    const today = this._formatDate(new Date());
    return this.events.filter(e => e.date === today);
  }

  navigate(delta) {
    this.currentDate.setMonth(this.currentDate.getMonth() + delta);
    this.selectedDate = null;
    this._notify();
  }

  goToday() {
    this.currentDate = new Date();
    this.selectedDate = null;
    this._notify();
  }

  setView(v) {
    this.view = v;
    // Sync date when switching views — share one source of truth
    if (v === 'day') {
      // Day view: use selectedDate if set, otherwise currentDate
      if (!this.selectedDate) this.selectedDate = this._formatDate(this.currentDate);
    } else if (v === 'week' && this.selectedDate) {
      // Week view: center on selectedDate if one is set
      const dt = this.selectedDate instanceof Date ? new Date(this.selectedDate) : new Date(this.selectedDate + 'T12:00:00');
      this.currentDate = dt;
    }
    this._notify();
  }
  selectDate(d) {
    this.selectedDate = d;
    // Sync currentDate so week/day views use the selected date
    if (d) {
      const dt = d instanceof Date ? new Date(d) : new Date(d + 'T12:00:00');
      this.currentDate = new Date(dt.getFullYear(), dt.getMonth(), 1);
    }
    this._notify();
  }
  navigateDay(delta) {
    if (!this.selectedDate) this.selectedDate = this._formatDate(new Date());
    const d = this.selectedDate instanceof Date ? new Date(this.selectedDate) : new Date(this.selectedDate + 'T12:00:00');
    d.setDate(d.getDate() + delta);
    this.selectedDate = this._formatDate(d);
    this.currentDate = new Date(d.getFullYear(), d.getMonth(), 1);
    this._notify();
  }
  selectEvent(e) { this.selectedEvent = e; this._notify(); }
  onChange(cb) { this.listeners.push(cb); }
  _notify() { this.listeners.forEach(cb => cb(this)); }

  // Get live leads from AppStore (single source of truth)
  getLiveLeads() {
    try {
      if (typeof window.AppStore !== 'undefined' && window.AppStore.getLeads) {
        return window.AppStore.getLeads();
      }
      return window.__leads || [];
    } catch(e) { return []; }
  }
}

// ================================================================
// CalendarRenderer
// ================================================================
class CalendarRenderer {
  constructor(state) {
    this.state = state;
    // Mounted calendars opt into the pending state before fetching. Direct
    // renderer consumers retain the settled-state contract.
    this.loading = false;
    this.rejected = false;
    this.layout = document.querySelector('.cal-layout');
    this.container = document.getElementById('calendarGrid');
    this.header = document.getElementById('calendarHeader');
    this.kpiBar = document.getElementById('calendarKpiBar');
    this.eventList = document.getElementById('calendarEventList');
    this.newEventArea = document.getElementById('calendarNewEventArea');
    this.polarisSection = document.getElementById('calendarPolaris');
  }

  setLoading(loading) {
    this.loading = Boolean(loading);
    this.rejected = false;
    if (this.layout) this.layout.setAttribute('aria-busy', String(this.loading));
  }

  setRejected() {
    this.loading = false;
    this.rejected = true;
    if (this.layout) this.layout.setAttribute('aria-busy', 'false');
  }

  render() {
    this.renderHeader();
    this.renderKpiBar();
    this.renderCalendarView();
    this.renderEventList();
    this.renderNewEventArea();
    this.renderPolaris();
  }

  // ═══════════════════════════════════════════════════════════════
  // Header
  // ═══════════════════════════════════════════════════════════════
  renderHeader() {
    if (!this.header) return;
    const s = this.state;
    const views = ['month','week','day','agenda'];
    this.header.innerHTML = `
      <div class="cal-header-left">
        <h1 class="cal-title">Calendar</h1>
        <div class="cal-nav-btns">
          <button class="cal-nav-btn" onclick="window.calState.navigate(-1)">‹</button>
          <button class="cal-nav-btn" onclick="window.calState.navigate(1)">›</button>
          <button class="cal-today-btn" onclick="window.calState.goToday()">Today</button>
        </div>
      </div>
      <div class="cal-header-right">
        <div class="cal-view-tabs">${views.map(v =>
          `<button class="cal-view-tab${v === s.view ? ' active' : ''}" onclick="window.calState.setView('${v}')">${v.charAt(0).toUpperCase()+v.slice(1)}</button>`
        ).join('')}</div>
      </div>`;
  }

  // ═══════════════════════════════════════════════════════════════
  // KPI Bar — 4 compact pills, left-aligned
  // ═══════════════════════════════════════════════════════════════
  renderKpiBar() {
    if (!this.kpiBar) return;
    var monthEvents = this.state.getEventsForMonth();
    var todayEvents = this.state.getTodayEvents();
    var totalEvents = this.state.events.length;
    var canonical = window.CanonicalIntelligence && window.CanonicalIntelligence.getPresentation('calendar');
    var pipelineValue = canonical && canonical.metrics ? canonical.metrics.estimatedRevenue : null;
    var unavailable = this.loading || this.rejected;
    var monthValue = unavailable ? '\u2014' : monthEvents.length;
    var todayValue = unavailable ? '\u2014' : todayEvents.length;
    var totalValue = unavailable ? '\u2014' : totalEvents;
    var pipelineText = unavailable ? '\u2014' : (pipelineValue == null ? 'Not calculated' : '$' + Number(pipelineValue).toLocaleString());

    this.kpiBar.innerHTML = `
      <span class="cal-kpi-pill"><span class="cal-kpi-icon">📅</span><span class="cal-kpi-num">${monthValue}</span><span class="cal-kpi-label">Appointments</span></span>
      <span class="cal-kpi-pill"><span class="cal-kpi-icon">📞</span><span class="cal-kpi-num">${todayValue}</span><span class="cal-kpi-label">Today</span></span>
      <span class="cal-kpi-pill"><span class="cal-kpi-icon">📊</span><span class="cal-kpi-num">${totalValue}</span><span class="cal-kpi-label">Events</span></span>
      <span class="cal-kpi-pill"><span class="cal-kpi-icon">💰</span><span class="cal-kpi-num">${pipelineText}</span><span class="cal-kpi-label">Pipeline</span></span>`;
  }

  // ═══════════════════════════════════════════════════════════════
  // Calendar View
  // ═══════════════════════════════════════════════════════════════
  renderCalendarView() {
    if (!this.container) return;
    switch (this.state.view) {
      case 'week': this._renderWeekView(); break;
      case 'day': this._renderDayView(); break;
      case 'agenda': this._renderAgendaView(); break;
      default: this._renderMonthView();
    }
  }

  _renderMonthView() {
    const s = this.state;
    const year = s.year, month = s.month;
    const firstDay = s.getFirstDayOfMonth();
    const daysInMonth = s.getDaysInMonth();
    const todayStr = s._formatDate(new Date());
    const selectedDate = s.selectedDate instanceof Date
      ? s.selectedDate
      : (s.selectedDate ? new Date(s.selectedDate + 'T12:00:00') : null);
    const selStr = selectedDate && !Number.isNaN(selectedDate.getTime()) ? s._formatDate(selectedDate) : '';
    const eventsByDate = {};
    s.events.forEach(e => { if (e.date) { eventsByDate[e.date] = eventsByDate[e.date] || []; eventsByDate[e.date].push(e); } });
    let html = '<div class="cal-month-grid">';
    ['SUN','MON','TUE','WED','THU','FRI','SAT'].forEach(d => { html += `<div class="cal-month-day-header">${d}</div>`; });
    for (let i = 0; i < firstDay; i++) html += '<div class="cal-month-cell cal-month-cell-empty"></div>';
    for (let d = 1; d <= daysInMonth; d++) {
      const date = new Date(year, month, d);
      const dateStr = s._formatDate(date);
      let cls = 'cal-month-cell';
      if (dateStr === todayStr) cls += ' cal-month-cell-today';
      if (dateStr === selStr) cls += ' cal-month-cell-selected';
      const dayEvents = eventsByDate[dateStr] || [];
      const maxDots = 3;
      html += `<div class="${cls}" onclick="window.calState.selectDate('${dateStr}')">`;
      html += `<div class="cal-month-cell-day">${d}</div>`;
      if (dayEvents.length > 0) {
        html += '<div class="cal-month-cell-events">';
        dayEvents.slice(0, maxDots).forEach(e => {
          html += `<div class="cal-month-event-dot" style="background:${e.color || '#6395ff'}" title="${e.title || ''}"></div>`;
        });
        if (dayEvents.length > maxDots) html += `<div class="cal-month-event-more">+${dayEvents.length - maxDots} more</div>`;
        html += '</div>';
      }
      html += '</div>';
    }
    for (let trailing = firstDay + daysInMonth; trailing < 42; trailing++) {
      html += '<div class="cal-month-cell cal-month-cell-empty"></div>';
    }
    html += '</div>';
    this.container.innerHTML = html;
  }

  _renderWeekView() {
    const s = this.state;
    const startOfWeek = new Date(s.currentDate);
    startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());
    const todayStr = s._formatDate(new Date());
    const dayNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    var hours = ['7:00 AM','8:00 AM','9:00 AM','10:00 AM','11:00 AM','12:00 PM','1:00 PM','2:00 PM','3:00 PM','4:00 PM','5:00 PM','6:00 PM','7:00 PM'];
    var eventsByDay = {};
    s.events.forEach(function(e) { if (e.date) { eventsByDay[e.date] = eventsByDay[e.date] || []; eventsByDay[e.date].push(e); } });
    var html = '<div class="cal-week-view"><div class="cal-week-grid">';
    // Header row
    html += '<div class="cal-week-row cal-week-header">';
    html += '<div class="cal-week-time"></div>';
    for (var wi = 0; wi < 7; wi++) {
      var wd = new Date(startOfWeek); wd.setDate(startOfWeek.getDate() + wi);
      var wds = s._formatDate(wd);
      var wcls = 'cal-week-day-header';
      if (wds === todayStr) wcls += ' cal-week-day-header-today';
      html += '<div class="' + wcls + '">' + dayNames[wi] + ' ' + wd.getDate() + '</div>';
    }
    html += '</div>';
    // Time rows — each hour slot shows only events whose time starts at that hour
    var hourMap = {7:0,8:1,9:2,10:3,11:4,12:5,13:6,14:7,15:8,16:9,17:10,18:11,19:12};
    var hourLabels = ['7:00 AM','8:00 AM','9:00 AM','10:00 AM','11:00 AM','12:00 PM','1:00 PM','2:00 PM','3:00 PM','4:00 PM','5:00 PM','6:00 PM','7:00 PM'];
    for (var hi = 0; hi < hourLabels.length; hi++) {
      var hour24 = hi + 7;
      html += '<div class="cal-week-row">';
      html += '<div class="cal-week-time">' + hourLabels[hi] + '</div>';
      for (var wi2 = 0; wi2 < 7; wi2++) {
        var wd2 = new Date(startOfWeek); wd2.setDate(startOfWeek.getDate() + wi2);
        var wds2 = s._formatDate(wd2);
        html += '<div class="cal-week-cell">';
        var dayEvts = eventsByDay[wds2] || [];
        // Match events by their time's hour (e.g., "8:00 AM" → hour 8)
        dayEvts.forEach(function(e) {
          if (!e.time) return;
          var eHour = parseInt(e.time.split(':')[0]);
          // Handle 12 AM → 0, 12 PM → 12
          if (e.time.indexOf('PM') > -1 && eHour !== 12) eHour += 12;
          if (e.time.indexOf('AM') > -1 && eHour === 12) eHour = 0;
          if (eHour === hour24) {
            html += '<div class="cal-week-event" style="background:' + (e.color || '#6395ff') + '" onclick="event.stopPropagation();window.calState.selectEvent(window.calState.events.find(function(ev){return ev.id===\'' + e.id + '\'}))">' + (e.title || '') + '</div>';
          }
        });
        html += '</div>';
      }
      html += '</div>';
    }
    html += '</div></div>';
    this.container.innerHTML = html;
  }

  _renderDayView() {
    const s = this.state;
    // Day view always uses currentDate — synced with month/week views
    if (!s.selectedDate) s.selectedDate = s._formatDate(s.currentDate);
    const day = s.selectedDate instanceof Date ? s.selectedDate : new Date(s.selectedDate + 'T12:00:00');
    const dayStr = s._formatDate(day);
    const dayEvents = s.events.filter(e => e.date === dayStr);
    const todayStr = s._formatDate(new Date());
    const isToday = dayStr === todayStr;
    const dayLabel = day.toLocaleDateString('en-US', { weekday:'long', month:'long', day:'numeric', year:'numeric' });
    let html = '<div class="cal-day-view">';
    // Navigation header
    html += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">';
    html += '<button class="cal-nav-btn" onclick="window.calState.navigateDay(-1)">‹</button>';
    html += `<h3 class="cal-day-title" style="margin:0;font-size:15px;">${dayLabel}${isToday ? ' <span style="color:#6395ff;font-size:11px;font-weight:600;">— Today</span>' : ''}</h3>`;
    html += '<button class="cal-nav-btn" onclick="window.calState.navigateDay(1)">›</button>';
    html += '</div>';
    // Hours 7AM-7PM
    var hours = ['7:00 AM','8:00 AM','9:00 AM','10:00 AM','11:00 AM','12:00 PM','1:00 PM','2:00 PM','3:00 PM','4:00 PM','5:00 PM','6:00 PM','7:00 PM'];
    hours.forEach(function(h, idx) {
      var hour24 = idx + 7;
      html += '<div class="cal-day-row">';
      html += '<div class="cal-day-time">' + h + '</div>';
      html += '<div class="cal-day-content">';
      dayEvents.forEach(function(e) {
        if (!e.time) return;
        var eHour = parseInt(e.time.split(':')[0]);
        if (e.time.indexOf('PM') > -1 && eHour !== 12) eHour += 12;
        if (e.time.indexOf('AM') > -1 && eHour === 12) eHour = 0;
        if (eHour === hour24) {
          html += '<div class="cal-day-event-card" onclick="window.calState.selectEvent(window.calState.events.find(function(ev){return ev.id===\'' + e.id + '\'}))">';
          html += '<div class="cal-day-event-time">' + (e.time || '') + '</div>';
          html += '<div class="cal-day-event-title">' + (e.title || 'Event') + '</div>';
          if (e.serviceType) html += '<div class="cal-day-event-desc">' + e.serviceType + '</div>';
          else if (e.estimatedPrice) html += '<div class="cal-day-event-desc">\$' + parseFloat(e.estimatedPrice).toLocaleString() + '</div>';
          html += '</div>';
        }
      });
      html += '</div></div>';
    });
    html += '</div>';
    this.container.innerHTML = html;
  }

  _renderAgendaView() {
    const s = this.state;
    const sorted = [...s.events].sort((a,b) => (a.date||'').localeCompare(b.date||''));
    const todayStr = s._formatDate(new Date());
    let html = '<div class="cal-agenda-view">';
    if (sorted.length === 0) {
      html += '<div class="cal-agenda-empty">No events scheduled. Use the + New Event button to add one.</div>';
    } else {
      let lastDate = '';
      sorted.forEach(e => {
        if (!e.date) return;
        if (e.date !== lastDate) {
          lastDate = e.date;
          const d = new Date(e.date);
          const dateLabel = d.toLocaleDateString('en-US', { weekday:'short', month:'short', day:'numeric', year:'numeric' });
          const isToday = e.date === todayStr;
          html += `<div class="cal-agenda-date ${isToday ? 'cal-agenda-date-today' : ''}">${dateLabel}${isToday ? ' — Today' : ''}</div>`;
          html += '<div class="cal-agenda-events">';
        }
        html += `<div class="cal-agenda-event" onclick="window.calState.selectEvent(window.calState.events.find(ev => ev.id === '${e.id}'))">`;
        html += `<div class="cal-agenda-event-color" style="background:${e.color || '#6395ff'}"></div>`;
        html += '<div class="cal-agenda-event-info">';
        html += `<div class="cal-agenda-event-title">${e.title || 'Event'}</div>`;
        if (e.time) html += `<div class="cal-agenda-event-time">${e.time}</div>`;
        if (e.description) html += `<div class="cal-agenda-event-desc">${e.description}</div>`;
        html += '</div></div>';
        // Close date group on next date
        const nextDate = sorted[sorted.indexOf(e) + 1];
        if (!nextDate || nextDate.date !== e.date) html += '</div>';
      });
    }
    html += '</div>';
    this.container.innerHTML = html;
  }

  // ═══════════════════════════════════════════════════════════════
  // Event List — below calendar, no mini calendar
  // ═══════════════════════════════════════════════════════════════
  renderEventList() {
    if (!this.eventList) return;
    const todayStr = this.state._formatDate(new Date());
    const todayEvents = this.state.events.filter(e => e.date === todayStr);
    let html = `<div class="cal-event-list-header">Today\u2019s Schedule</div>`;
    if (this.loading) {
      html += `<div class="cal-event-list-empty" role="status" aria-live="polite">Loading schedule\u2026</div>`;
    } else if (this.rejected) {
      html += `<div class="cal-event-list-empty" role="alert" aria-live="assertive">Calendar data unavailable. Try again.</div>`;
    } else if (todayEvents.length === 0) {
      html += `<div class="cal-event-list-empty">No events scheduled for today</div>`;
    } else {
      todayEvents.forEach(e => {
        html += `<div class="cal-event-list-item" onclick="window.calState.selectEvent(window.calState.events.find(ev => ev.id==='${e.id}'))">`;
        html += `<div class="cal-event-list-dot" style="background:${e.color || '#6395ff'}"></div>`;
        html += '<div class="cal-event-list-info">';
        html += `<div class="cal-event-list-title">${e.title || 'Event'}</div>`;
        if (e.time) html += `<div class="cal-event-list-time">${e.time}</div>`;
        html += '</div>';
        if (e.estimatedPrice) html += `<div class="cal-event-list-value">$${parseFloat(e.estimatedPrice).toLocaleString()}</div>`;
        html += '</div>';
      });
    }
    this.eventList.innerHTML = html;
  }

  // ═══════════════════════════════════════════════════════════════
  // New Event button — below event list
  // ═══════════════════════════════════════════════════════════════
  renderNewEventArea() {
    if (!this.newEventArea) return;
    this.newEventArea.innerHTML = `<button class="cal-new-event-btn" onclick="window.openEventModal()" style="width:100%;padding:7px 14px;background:#6395ff;color:#fff;border:none;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;display:block;text-align:center;">+ New Event</button>`;
  }

  // ═══════════════════════════════════════════════════════════════
  // Polaris — uses shared polaris-card component (same as Dashboard)
  // ═══════════════════════════════════════════════════════════════
  renderPolaris() {
    if (!this.polarisSection) return;
    const canonical = window.CanonicalIntelligence && window.CanonicalIntelligence.getPresentation('calendar');
    const presentation = window.PolarisEngine && window.PolarisEngine.selectPresentation(canonical);
    const values = presentation && presentation.values;
    function esc(value) {
      return String(value == null ? '' : value).replace(/[&<>"']/g, function(character) {
        return ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[character];
      });
    }
    let html = '<div class="polaris-card">';
    html += '<div class="polaris-header">';
    html += '<h2 style="font-size:15px;font-weight:700;color:#e8eaed;display:flex;align-items:center;gap:6px;margin:0;letter-spacing:0.01em;">POLARIS<span style="font-size:9px;color:#9aa0a6;font-weight:400;vertical-align:super;">&#8482;</span> <span style="font-weight:400;font-size:13px;color:#9aa0a6;">Intelligence</span></h2>';
    html += '<span class="cal-polaris-badge" style="background:#a67c00;color:#fff;font-size:10px;font-weight:700;padding:4px 10px;border-radius:6px;letter-spacing:0.05em;">&#10022; CANONICAL</span>';
    html += '</div>';
    html += '<div class="polaris-grid" style="display:flex;flex-direction:column;gap:0;">';
    if (this.loading) {
      html += '<div class="cal-polaris-row"><span class="cal-polaris-label">Status</span><span class="cal-polaris-value">Loading calendar intelligence&hellip;</span></div>';
    } else if (!values) {
      html += '<div class="cal-polaris-row"><span class="cal-polaris-label">Status</span><span class="cal-polaris-value">Canonical intelligence unavailable</span></div>';
    } else {
      html += '<div class="cal-polaris-row"><span class="cal-polaris-label">Customer Price</span><span class="cal-polaris-value">' + esc(presentation.customerPriceText) + '</span></div>';
      html += '<div class="cal-polaris-row"><span class="cal-polaris-label">Scope</span><span class="cal-polaris-value">' + esc(JSON.stringify(values.service && values.service.scope)) + '</span></div>';
      html += '<div class="cal-polaris-row"><span class="cal-polaris-label">Labor</span><span class="cal-polaris-value">' + esc(values.laborCharge == null ? 'Not calculated' : '$' + Number(values.laborCharge).toLocaleString()) + ' / ' + esc(values.laborHours == null ? 'Not calculated' : values.laborHours + ' hours') + '</span></div>';
      html += '<div class="cal-polaris-row"><span class="cal-polaris-label">Duration</span><span class="cal-polaris-value">' + esc(values.estimatedProductionDurationHours == null ? 'Not calculated' : values.estimatedProductionDurationHours + ' hours') + '</span></div>';
      html += '<div class="cal-polaris-row"><span class="cal-polaris-label">Travel</span><span class="cal-polaris-value">' + esc(JSON.stringify(values.travel)) + '</span></div>';
      html += '<div class="cal-polaris-row"><span class="cal-polaris-label">Gross Profit</span><span class="cal-polaris-value">' + esc(presentation.grossProfitText) + '</span></div>';
      html += '<div class="cal-polaris-row"><span class="cal-polaris-label">Confidence</span><span class="cal-polaris-value">' + esc(presentation.confidenceText) + '</span></div>';
      html += '<div class="cal-polaris-row"><span class="cal-polaris-label">Risk</span><span class="cal-polaris-value">' + esc(presentation.riskText) + '</span></div>';
      html += '<div class="cal-polaris-row" style="border-bottom:none;"><span class="cal-polaris-label">AI Recommendation</span><span class="cal-polaris-value">' + esc(presentation.recommendedActionText || 'No recommendation recorded') + '</span></div>';
    }
    html += '</div></div>';
    this.polarisSection.innerHTML = html;
  }
}

// ================================================================
// CalendarData — API calls
// ================================================================
class CalendarData {
      constructor() { this.baseUrl = '/api/v1/calendar'; }

      _authHeaders() {
        return {};
      }

      async fetchEvents() {
        try {
          await window.CanonicalIntelligence.loadCompatibility('calendar');
          return window.syncCalendarFromAppStore ? window.syncCalendarFromAppStore() : [];
        }
        catch(e) { console.warn('[CalendarData] fetchEvents:', e.message); throw e; }
      }

      async createEvent(data) {
        console.warn('[CalendarData] Canonical graph creation is not available from the Calendar presentation surface.');
        return null;
      }

      async updateEvent(id, data) {
        try {
          var start = data.date && data.time ? new Date(data.date + 'T' + data.time).toISOString() : null;
          var end = data.date && data.endTime ? new Date(data.date + 'T' + data.endTime).toISOString() : null;
          var headers = Object.assign({'Content-Type':'application/json'}, this._authHeaders());
          var context = window.CanonicalIntelligence.synchronizeAuthority();
          if (context.sessionId) headers['X-NorthStar-Session-ID'] = context.sessionId;
          const r = await window.NorthStarAccountSession.fetch('/api/v1/canonical/appointments/' + encodeURIComponent(id), {
            method:'PATCH', headers:headers, body:JSON.stringify({ scheduledStart:start, scheduledEnd:end, status:'scheduled' })
          });
          const d = await r.json();
          if (!r.ok) throw new Error(d && d.error && d.error.message || 'Appointment update failed.');
          await window.CanonicalIntelligence.loadCompatibility('calendar');
          return d.data;
        }
        catch(e) { console.warn('[CalendarData] updateEvent:', e.message); return null; }
      }

      async deleteEvent(id) {
        console.warn('[CalendarData] Canonical deletion is not available from the Calendar presentation surface.');
        return false;
      }

      async exportICS() {
        try { const r = await window.NorthStarAccountSession.fetch(`${this.baseUrl}/export/ics`, { headers: this._authHeaders() }); const blob = await r.blob(); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'calendar.ics'; a.click(); URL.revokeObjectURL(url); }
        catch(e) { console.warn('[CalendarData] exportICS:', e.message); }
      }

      async importICS(icsContent) {
        try { const r = await window.NorthStarAccountSession.fetch(`${this.baseUrl}/import/ics`, { method:'POST', headers:Object.assign({'Content-Type':'application/json'}, this._authHeaders()), body:JSON.stringify({icsContent}) }); return await r.json(); }
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

// Present authoritative calendar records. The historical function name is
// retained for the PR #68 readiness contract; it no longer synthesizes events.
window.syncCalendarFromAppStore = function() {
  var projection = window.CanonicalIntelligence && window.CanonicalIntelligence.getProjection('calendar');
    var records = projection && Array.isArray(projection.records) ? projection.records : [];
    return records.map(function(record) {
      var start = record.scheduledStart ? new Date(record.scheduledStart) : null;
      var end = record.scheduledEnd ? new Date(record.scheduledEnd) : null;
      var presentation = window.PolarisEngine && window.PolarisEngine.selectPresentation(record.canonical);
      var values = presentation && presentation.values;
    return {
      id: record.id,
      title: record.customer && record.customer.name || 'Appointment',
      date: start && !isNaN(start.getTime()) ? calState._formatDate(start) : null,
      time: start && !isNaN(start.getTime()) ? start.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : null,
      endTime: end && !isNaN(end.getTime()) ? end.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : null,
      type: 'canonical',
      leadId: record.canonical && record.canonical.ids.opportunity,
      phone: record.customer && record.customer.phone,
      address: record.customer && record.customer.address,
      serviceType: presentation && presentation.serviceText ? presentation.serviceText : undefined,
      estimatedPrice: presentation ? presentation.customerPrice : null,
      color: '#6395ff',
      status: record.status,
      duration: values ? values.estimatedProductionDurationHours : null,
      calculationVersion: record.canonical && record.canonical.calculationVersion,
      snapshotDigest: record.canonical && record.canonical.snapshotDigest,
      readOnly: true
    };
  });
};

window.refreshCalendar = async function() {
  try {
    const [apiEvents, leadEvents] = await Promise.all([
      calData.fetchEvents().catch(() => []),
      Promise.resolve(window.syncCalendarFromAppStore())
    ]);
    const existingIds = new Set(apiEvents.map(e => e.id));
    const newLeadEvents = leadEvents.filter(e => !existingIds.has(e.id));
    calState.events = [...apiEvents, ...newLeadEvents];
  } catch(e) {
    calState.events = window.syncCalendarFromAppStore();
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

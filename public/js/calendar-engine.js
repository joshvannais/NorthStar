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
    this._notify();
  }

  goToday() {
    this.currentDate = new Date();
    this._notify();
  }

  setView(v) { this.view = v; this._notify(); }
  selectDate(d) { this.selectedDate = d; this._notify(); }
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
    this.container = document.getElementById('calendarGrid');
    this.header = document.getElementById('calendarHeader');
    this.kpiBar = document.getElementById('calendarKpiBar');
    this.eventList = document.getElementById('calendarEventList');
    this.newEventArea = document.getElementById('calendarNewEventArea');
    this.polarisSection = document.getElementById('calendarPolaris');
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
    const monthEvents = this.state.getEventsForMonth();
    const todayEvents = this.state.getTodayEvents();
    const totalEvents = this.state.events.length;
    const allLeads = this.state.getLiveLeads();
    const qualifiedLeads = allLeads.filter(l => l.status === 'new' || l.status === 'contacted' || l.status === 'qualified');
    const pipelineValue = qualifiedLeads.reduce((sum, l) => sum + (parseFloat(l.avgPrice || l.estimated_price) || 0), 0);

    this.kpiBar.innerHTML = `
      <span class="cal-kpi-pill"><span class="cal-kpi-icon">📅</span><span class="cal-kpi-num">${monthEvents.length}</span><span class="cal-kpi-label">Appointments</span></span>
      <span class="cal-kpi-pill"><span class="cal-kpi-icon">📞</span><span class="cal-kpi-num">${todayEvents.length}</span><span class="cal-kpi-label">Today</span></span>
      <span class="cal-kpi-pill"><span class="cal-kpi-icon">📊</span><span class="cal-kpi-num">${totalEvents}</span><span class="cal-kpi-label">Events</span></span>
      <span class="cal-kpi-pill"><span class="cal-kpi-icon">💰</span><span class="cal-kpi-num">$${pipelineValue.toLocaleString()}</span><span class="cal-kpi-label">Pipeline</span></span>`;
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
    const selStr = s.selectedDate ? s._formatDate(s.selectedDate) : '';
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
    html += '</div>';
    this.container.innerHTML = html;
  }

  _renderWeekView() {
    const s = this.state;
    const startOfWeek = new Date(s.currentDate);
    startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());
    const todayStr = s._formatDate(new Date());
    const dayNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    const hours = Array.from({length:12}, (_,i) => (i+7)+':00');
    const eventsByDay = {};
    s.events.forEach(e => { if (e.date) { eventsByDay[e.date] = eventsByDay[e.date] || []; eventsByDay[e.date].push(e); } });
    let html = '<div class="cal-week-view"><div class="cal-week-grid">';
    // Header row
    html += '<div class="cal-week-row cal-week-header">';
    html += '<div class="cal-week-time"></div>';
    for (let i = 0; i < 7; i++) {
      const d = new Date(startOfWeek); d.setDate(startOfWeek.getDate() + i);
      const ds = s._formatDate(d);
      let cls = 'cal-week-day-header';
      if (ds === todayStr) cls += ' cal-week-day-header-today';
      html += `<div class="${cls}">${dayNames[i]} ${d.getDate()}</div>`;
    }
    html += '</div>';
    // Time rows
    hours.forEach(h => {
      html += '<div class="cal-week-row">';
      html += `<div class="cal-week-time">${h}</div>`;
      for (let i = 0; i < 7; i++) {
        const d = new Date(startOfWeek); d.setDate(startOfWeek.getDate() + i);
        const ds = s._formatDate(d);
        html += '<div class="cal-week-cell">';
        const dayEvts = eventsByDay[ds] || [];
        dayEvts.forEach(e => {
          html += `<div class="cal-week-event" style="background:${e.color || '#6395ff'}" onclick="event.stopPropagation();window.calState.selectEvent(window.calState.events.find(ev => ev.id==='${e.id}'))">${e.title || ''}</div>`;
        });
        html += '</div>';
      }
      html += '</div>';
    });
    html += '</div></div>';
    this.container.innerHTML = html;
  }

  _renderDayView() {
    const s = this.state;
    const day = s.selectedDate ? new Date(s.selectedDate) : new Date();
    const dayStr = s._formatDate(day);
    const dayEvents = s.events.filter(e => e.date === dayStr);
    const dayLabel = day.toLocaleDateString('en-US', { weekday:'long', month:'long', day:'numeric', year:'numeric' });
    let html = '<div class="cal-day-view">';
    html += `<h3 class="cal-day-title">${dayLabel}</h3>`;
    const hours = Array.from({length:12}, (_,i) => (i+7)+':00');
    hours.forEach(h => {
      html += '<div class="cal-day-row">';
      html += `<div class="cal-day-time">${h}</div>`;
      html += '<div class="cal-day-content">';
      dayEvents.filter(e => (e.time||'').startsWith(h.replace(':00',''))).forEach(e => {
        html += `<div class="cal-day-event-card" onclick="window.calState.selectEvent(window.calState.events.find(ev => ev.id==='${e.id}'))">`;
        if (e.time) html += `<div class="cal-day-event-time">${e.time}</div>`;
        html += `<div class="cal-day-event-title">${e.title || 'Event'}</div>`;
        if (e.description) html += `<div class="cal-day-event-desc">${e.description}</div>`;
        html += '</div>';
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
    if (todayEvents.length === 0) {
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
    this.newEventArea.innerHTML = `<button class="cal-new-event-btn" onclick="window.openEventModal()">+ New Event</button>`;
  }

  // ═══════════════════════════════════════════════════════════════
  // Polaris — uses shared polaris-card component (same as Dashboard)
  // ═══════════════════════════════════════════════════════════════
  renderPolaris() {
    if (!this.polarisSection) return;
    // Insert the shared polaris-card HTML (same structure as Dashboard)
    this.polarisSection.innerHTML = `
      <div class="polaris-card">
        <div class="polaris-header">
          <h2>POLARIS<sup>™</sup> Intelligence</h2>
          <span class="polaris-badge">LIVE</span>
        </div>
        <div class="polaris-grid" id="polarisCardGrid">
          <div class="polaris-item">
            <div class="polaris-item-label">Top Opportunity</div>
            <div class="polaris-item-value" id="polarisTopOpp">—</div>
            <div class="polaris-item-desc" id="polarisTopOppDesc">—</div>
            <div class="polaris-confidence" id="polarisTopConf">—</div>
          </div>
          <div class="polaris-item">
            <div class="polaris-item-label">Pipeline Value</div>
            <div class="polaris-item-value" id="polarisPipeline">$0</div>
            <div class="polaris-item-desc" id="polarisPipelineDesc">Total qualified pipeline</div>
            <div class="polaris-confidence" id="polarisPipeConf">—</div>
          </div>
          <div class="polaris-item">
            <div class="polaris-item-label">Recommended Focus</div>
            <div class="polaris-item-value" id="polarisFocus">—</div>
            <div class="polaris-item-desc" id="polarisFocusDesc">—</div>
            <div class="polaris-confidence" id="polarisFocusConf">—</div>
          </div>
        </div>
      </div>`;
    // Let the shared PolarisEngine populate it (same as Dashboard)
    try {
      if (typeof window.PolarisEngine !== 'undefined' && window.PolarisEngine.renderPolarisCard) {
        window.PolarisEngine.renderPolarisCard(this.state.getLiveLeads());
      }
    } catch(e) { console.warn('[Calendar] PolarisEngine:', e.message); }
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
window.syncCalendarFromAppStore = function() {
  const allLeads = calState.getLiveLeads();
  const leadEvents = allLeads
    .filter(l => l.status === 'booked' || l.status === 'appointment-set' || l.outcome === 'appointment-set' || l.appointment_date)
    .map(l => ({
      id: 'lead-' + l.id,
      title: l.caller_name || l.caller || 'Appointment',
      date: l.appointment_date || (l.createdAt ? l.createdAt.split('T')[0] : ''),
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
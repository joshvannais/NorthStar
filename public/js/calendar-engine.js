/**
 * NorthStar Calendar Engine — Mockup-matched implementation
 * One calendar, one event list, one Polaris intelligence section.
 * Single source of truth: AppStore (shared with Dashboard).
 */
"use strict";

function escapeCalendarMarkup(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, function(character) {
    return ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[character];
  });
}

function safeCalendarColor(value) {
  return /^#[0-9a-f]{6}$/i.test(String(value || '')) ? String(value) : '#6395ff';
}

function calendarTimeValue(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  return String(date.getHours()).padStart(2, '0') + ':' + String(date.getMinutes()).padStart(2, '0');
}

function calendarScheduleLabel(event) {
  if (!event || !event.rawScheduledStart || !event.rawScheduledEnd) return 'Schedule unavailable';
  var start = new Date(event.rawScheduledStart);
  var end = new Date(event.rawScheduledEnd);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 'Schedule unavailable';
  return start.toLocaleString([], { weekday:'short', month:'short', day:'numeric', hour:'numeric', minute:'2-digit' }) +
    ' to ' + end.toLocaleString([], { weekday:'short', month:'short', day:'numeric', hour:'numeric', minute:'2-digit' });
}

function calendarEventButton(event, className, content, options) {
  options = options || {};
  var label = 'Edit schedule for ' + (event.title || 'appointment') + ', currently ' + calendarScheduleLabel(event);
  var draggable = options.draggable ? ' draggable="true"' : '';
  return '<button type="button" class="' + className + ' cal-schedule-event" data-calendar-event-action="edit" ' +
    'data-calendar-event-id="' + escapeCalendarMarkup(event.id) + '" aria-label="' + escapeCalendarMarkup(label) + '"' +
    draggable + '>' + content + '</button>';
}

function calendarResizeButton(event, className) {
  return '<button type="button" class="' + className + ' cal-schedule-resize" data-calendar-event-action="resize" ' +
    'data-calendar-event-id="' + escapeCalendarMarkup(event.id) + '" aria-label="Resize schedule for ' +
    escapeCalendarMarkup(event.title || 'appointment') + '">Resize</button>';
}

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
      const d = new Date(e.date + 'T12:00:00');
      return d.getMonth() === this.month && d.getFullYear() === this.year;
    });
  }

  getTodayEvents() {
    const today = this._formatDate(new Date());
    return this.events.filter(e => e.date === today);
  }

  navigate(delta) {
    if (this.view === 'day') {
      this.navigateDay(delta);
      return;
    }
    if (this.view === 'week') {
      const anchor = this.selectedDate
        ? new Date(this.selectedDate + 'T12:00:00')
        : new Date(this.currentDate);
      anchor.setDate(anchor.getDate() + (delta * 7));
      this.currentDate = anchor;
      this.selectedDate = this._formatDate(anchor);
      this._notify();
      return;
    }
    this.currentDate = new Date(this.year, this.month + delta, 1);
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
      this.currentDate = dt;
    }
    this._notify();
  }
  navigateDay(delta) {
    if (!this.selectedDate) this.selectedDate = this._formatDate(new Date());
    const d = this.selectedDate instanceof Date ? new Date(this.selectedDate) : new Date(this.selectedDate + 'T12:00:00');
    d.setDate(d.getDate() + delta);
    this.selectedDate = this._formatDate(d);
    this.currentDate = d;
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
    var openEventAction = event => {
      var trigger = event.target.closest('[data-calendar-event-action][data-calendar-event-id]');
      if (!trigger) return;
      event.preventDefault();
      event.stopPropagation();
      var id = trigger.getAttribute('data-calendar-event-id');
      var selected = this.state.events.find(function(candidate) { return String(candidate.id) === id; });
      if (!selected) return;
      var action = trigger.getAttribute('data-calendar-event-action') === 'resize'
        ? 'calendar_resize' : 'calendar_edit';
      if (action === 'calendar_resize' && this.suppressResizeClick === id) {
        this.suppressResizeClick = null;
        return;
      }
      window.calModal.openEditEvent(selected, { action: action, returnFocus: trigger });
    };
    var dragStart = event => {
      var trigger = event.target.closest('[draggable="true"][data-calendar-event-id]');
      if (!trigger || !event.dataTransfer) return;
      this.draggedEventId = trigger.getAttribute('data-calendar-event-id');
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', this.draggedEventId);
    };
    var dragOver = event => {
      if (!this.draggedEventId || !event.target.closest('[data-calendar-drop-date]')) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    };
    var drop = event => {
      var target = event.target.closest('[data-calendar-drop-date][data-calendar-drop-hour]');
      if (!target || !this.draggedEventId) return;
      event.preventDefault();
      var selected = this.state.events.find(candidate => String(candidate.id) === this.draggedEventId);
      this.draggedEventId = null;
      if (!selected) return;
      var originalStart = new Date(selected.rawScheduledStart);
      var originalEnd = new Date(selected.rawScheduledEnd);
      if (Number.isNaN(originalStart.getTime()) || Number.isNaN(originalEnd.getTime())) return;
      var proposedStart = new Date(target.getAttribute('data-calendar-drop-date') + 'T' +
        String(target.getAttribute('data-calendar-drop-hour')).padStart(2, '0') + ':00');
      var proposedEnd = new Date(proposedStart.getTime() + (originalEnd.getTime() - originalStart.getTime()));
      window.calModal.openEditEvent(selected, {
        action: 'calendar_drag_drop',
        returnFocus: document.querySelector('[data-calendar-event-action="edit"][data-calendar-event-id="' + CSS.escape(String(selected.id)) + '"]'),
        proposal: {
          date: this.state._formatDate(proposedStart),
          time: calendarTimeValue(proposedStart),
          endDate: this.state._formatDate(proposedEnd),
          endTime: calendarTimeValue(proposedEnd)
        }
      });
    };
    var pointerStart = event => {
      var trigger = event.target.closest('[data-calendar-event-action="resize"][data-calendar-event-id]');
      if (!trigger || (event.pointerType === 'mouse' && event.button !== 0)) return;
      this.resizeGesture = {
        id: trigger.getAttribute('data-calendar-event-id'),
        startY: event.clientY,
        trigger: trigger,
        pointerId: event.pointerId
      };
      if (trigger.setPointerCapture) trigger.setPointerCapture(event.pointerId);
    };
    var pointerEnd = event => {
      var gesture = this.resizeGesture;
      this.resizeGesture = null;
      if (!gesture || gesture.pointerId !== event.pointerId || Math.abs(event.clientY - gesture.startY) < 8) return;
      var selected = this.state.events.find(candidate => String(candidate.id) === gesture.id);
      if (!selected) return;
      var start = new Date(selected.rawScheduledStart);
      var end = new Date(selected.rawScheduledEnd);
      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return;
      var steps = Math.round((event.clientY - gesture.startY) / 24);
      if (steps === 0) steps = event.clientY > gesture.startY ? 1 : -1;
      var proposedEnd = new Date(Math.max(start.getTime() + 15 * 60000, end.getTime() + steps * 30 * 60000));
      this.suppressResizeClick = gesture.id;
      window.calModal.openEditEvent(selected, {
        action: 'calendar_resize',
        returnFocus: gesture.trigger,
        proposal: {
          date: selected.date,
          time: selected.timeValue,
          endDate: this.state._formatDate(proposedEnd),
          endTime: calendarTimeValue(proposedEnd)
        }
      });
    };
    [this.container, this.eventList].filter(Boolean).forEach(function(root) {
      root.addEventListener('click', openEventAction);
    });
    if (this.container) {
      this.container.addEventListener('dragstart', dragStart);
      this.container.addEventListener('dragover', dragOver);
      this.container.addEventListener('drop', drop);
      this.container.addEventListener('dragend', () => { this.draggedEventId = null; });
      this.container.addEventListener('pointerdown', pointerStart);
      this.container.addEventListener('pointerup', pointerEnd);
      this.container.addEventListener('pointercancel', () => { this.resizeGesture = null; });
    }
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
  }

  // ═══════════════════════════════════════════════════════════════
  // Header
  // ═══════════════════════════════════════════════════════════════
  renderHeader() {
    if (!this.header) return;
    const s = this.state;
    const views = ['month','week','day','agenda'];
    const periodLabel = s.view === 'day'
      ? new Date((s.selectedDate || s._formatDate(s.currentDate)) + 'T12:00:00').toLocaleDateString('en-US', { month:'long', day:'numeric', year:'numeric' })
      : s.getMonthLabel();
    const unit = s.view === 'day' ? 'day' : (s.view === 'week' ? 'week' : (s.view === 'agenda' ? 'period' : 'month'));
    this.header.innerHTML = `
      <div class="cal-header-left">
        <h1 class="cal-title">Calendar</h1>
        <div class="cal-nav-btns">
          <button class="cal-nav-btn" onclick="window.calState.navigate(-1)" aria-label="Previous ${unit}">‹</button>
          <button class="cal-nav-btn" onclick="window.calState.navigate(1)" aria-label="Next ${unit}">›</button>
          <button class="cal-today-btn" onclick="window.calState.goToday()">Today</button>
        </div>
        <div class="cal-period-label" aria-live="polite">${escapeCalendarMarkup(periodLabel)}</div>
      </div>
      <div class="cal-header-right">
        <div class="cal-view-tabs">${views.map(v =>
           `<button class="cal-view-tab${v === s.view ? ' active' : ''}" onclick="window.calState.setView('${v}')" aria-pressed="${v === s.view}">${v.charAt(0).toUpperCase()+v.slice(1)}</button>`
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
    var pipelineText = unavailable ? '\u2014' : (pipelineValue == null
      ? 'Unavailable — no role-authorized estimate is recorded'
      : '$' + Number(pipelineValue).toLocaleString());

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
          html += calendarEventButton(e, 'cal-month-event-button',
            `<span class="cal-month-event-dot" style="background:${safeCalendarColor(e.color)}"></span>`);
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
        html += '<div class="cal-week-cell" data-calendar-drop-date="' + wds2 + '" data-calendar-drop-hour="' + hour24 + '">';
        var dayEvts = eventsByDay[wds2] || [];
        // Match events by their time's hour (e.g., "8:00 AM" → hour 8)
        dayEvts.forEach(function(e) {
          if (!e.time) return;
          var eHour = parseInt(e.time.split(':')[0]);
          // Handle 12 AM → 0, 12 PM → 12
          if (e.time.indexOf('PM') > -1 && eHour !== 12) eHour += 12;
          if (e.time.indexOf('AM') > -1 && eHour === 12) eHour = 0;
          if (eHour === hour24) {
            html += '<div class="cal-week-event-group" style="background:' + safeCalendarColor(e.color) + '">';
            html += calendarEventButton(e, 'cal-week-event',
              '<span class="cal-week-event-title">' + escapeCalendarMarkup(e.title || 'Event') + '</span>' +
              '<span class="cal-week-event-time">' + escapeCalendarMarkup(e.time || '') + '</span>',
              { draggable: true });
            html += calendarResizeButton(e, 'cal-week-resize');
            html += '</div>';
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
          var card = '<span class="cal-day-event-time">' + escapeCalendarMarkup(e.time || '') + '</span>';
          card += '<span class="cal-day-event-title">' + escapeCalendarMarkup(e.title || 'Event') + '</span>';
          if (e.serviceType) card += '<span class="cal-day-event-desc">' + escapeCalendarMarkup(e.serviceType) + '</span>';
          else if (e.estimatedPrice) card += '<span class="cal-day-event-desc">\$' + parseFloat(e.estimatedPrice).toLocaleString() + '</span>';
          html += '<div class="cal-day-event-group">' + calendarEventButton(e, 'cal-day-event-card', card) +
            calendarResizeButton(e, 'cal-day-resize') + '</div>';
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
          const d = new Date(e.date + 'T12:00:00');
          const dateLabel = d.toLocaleDateString('en-US', { weekday:'short', month:'short', day:'numeric', year:'numeric' });
          const isToday = e.date === todayStr;
          html += `<div class="cal-agenda-date ${isToday ? 'cal-agenda-date-today' : ''}">${dateLabel}${isToday ? ' — Today' : ''}</div>`;
          html += '<div class="cal-agenda-events">';
        }
        var agenda = `<span class="cal-agenda-event-color" style="background:${safeCalendarColor(e.color)}"></span>`;
        agenda += '<span class="cal-agenda-event-info">';
        agenda += `<span class="cal-agenda-event-title">${escapeCalendarMarkup(e.title || 'Event')}</span>`;
        if (e.time) agenda += `<span class="cal-agenda-event-time">${escapeCalendarMarkup(e.time)}</span>`;
        agenda += `<span class="cal-agenda-event-schedule">${escapeCalendarMarkup(calendarScheduleLabel(e))}</span>`;
        if (e.description) agenda += `<span class="cal-agenda-event-desc">${escapeCalendarMarkup(e.description)}</span>`;
        agenda += '</span>';
        html += '<div class="cal-agenda-event-group">' + calendarEventButton(e, 'cal-agenda-event', agenda) +
          calendarResizeButton(e, 'cal-agenda-resize') + '</div>';
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
        var item = `<span class="cal-event-list-dot" style="background:${safeCalendarColor(e.color)}"></span>`;
        item += '<span class="cal-event-list-info">';
        item += `<span class="cal-event-list-title">${escapeCalendarMarkup(e.title || 'Event')}</span>`;
        if (e.time) item += `<span class="cal-event-list-time">${escapeCalendarMarkup(e.time)}</span>`;
        item += '</span>';
        if (e.estimatedPrice) item += `<span class="cal-event-list-value">$${parseFloat(e.estimatedPrice).toLocaleString()}</span>`;
        html += calendarEventButton(e, 'cal-event-list-item', item);
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

}

// ================================================================
// CalendarData — API calls
// ================================================================
class CalendarData {
      constructor() { this.baseUrl = '/api/v1/calendar'; }

      _authHeaders() {
        return {};
      }

      readAuthorizedEvents() {
        var client = window.CanonicalIntelligence;
        var projection = client && client.getProjection('calendar');
        var root = window.document && window.document.documentElement;
        if (!projection || !root || root.dataset.canonicalAuthority !== 'server') {
          throw new Error('Current Calendar data authority is unavailable.');
        }
        var events = window.syncCalendarFromAppStore ? window.syncCalendarFromAppStore() : [];
        if (client.getProjection('calendar') !== projection || root.dataset.canonicalAuthority !== 'server') {
          throw new Error('Calendar data authority changed during settlement.');
        }
        return Array.isArray(events) ? events : [];
      }

      async fetchEvents() {
        try {
          await window.CanonicalIntelligence.loadCompatibility('calendar');
          return this.readAuthorizedEvents();
        }
        catch(e) { console.warn('[CalendarData] fetchEvents:', e.message); throw e; }
      }

      async createEvent(data) {
        console.warn('[CalendarData] Canonical graph creation is not available from the Calendar presentation surface.');
        return null;
      }

      async updateEvent(id, data) {
        var current = calState.events.find(function(event) { return String(event.id) === String(id); });
        var authority = current && current.scheduleAuthority;
        if (!authority || !Number.isSafeInteger(authority.revision) ||
            !/^[0-9a-f]{64}$/.test(authority.digest || '')) {
          return { ok:false, status:409, code:'M22_STALE_APPROVAL',
            message:'Current schedule revision is unavailable. Refresh Calendar before approving this change.' };
        }
        if (!window.crypto || typeof window.crypto.randomUUID !== 'function') {
          return { ok:false, status:503, code:'IDEMPOTENCY_UNAVAILABLE',
            message:'Secure approval identity is unavailable. No schedule change was sent.' };
        }
        var action = ['calendar_edit','calendar_drag_drop','calendar_resize'].includes(data.action)
          ? data.action : 'calendar_edit';
        var startDate = new Date(data.date + 'T' + data.time);
        var endDate = new Date(data.endDate + 'T' + data.endTime);
        if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime()) || endDate <= startDate) {
          return { ok:false, status:400, code:'INVALID_APPOINTMENT_SCHEDULE',
            message:'The end of the schedule must be after its start.' };
        }
        var prefixes = {
          calendar_edit: 'calendar-edit-',
          calendar_drag_drop: 'calendar-drag-drop-',
          calendar_resize: 'calendar-resize-'
        };
        var headers = Object.assign({'Content-Type':'application/json'}, this._authHeaders());
        var context = window.CanonicalIntelligence.synchronizeAuthority();
        if (context.sessionId) headers['X-NorthStar-Session-ID'] = context.sessionId;
        headers['Idempotency-Key'] = prefixes[action] + window.crypto.randomUUID();
        try {
          var response = await window.NorthStarAccountSession.fetch('/api/v1/canonical/appointments/' + encodeURIComponent(id), {
            method:'PATCH', headers:headers, body:JSON.stringify({
              scheduledStart:startDate.toISOString(),
              scheduledEnd:endDate.toISOString(),
              status:'scheduled',
              expectedRevision:authority.revision,
              expectedDigest:authority.digest,
              action:action,
              reason:data.reason
            })
          });
          var body = {};
          try { body = await response.json(); } catch (_) { body = {}; }
          if (!response.ok) {
            return {
              ok:false,
              status:response.status,
              code:body.code || body.error && body.error.code || 'APPOINTMENT_UPDATE_FAILED',
              message:body.error && body.error.message || body.message || 'Appointment update failed.'
            };
          }
          return { ok:true, status:response.status, data:body.data };
        } catch (error) {
          console.warn('[CalendarData] updateEvent:', error.message);
          return { ok:false, status:503, code:'CANONICAL_PERSISTENCE_UNAVAILABLE',
            message:'Schedule service is unavailable. No schedule change was approved.' };
        }
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
    const dateStr = date ? this._formatDate(date) : this._formatDate(new Date());
    const html = `
      <div class="cal-modal-overlay" id="calModalOverlay" onclick="window.calModal.close()">
        <div class="cal-modal" role="dialog" aria-modal="true" aria-labelledby="calModalTitle" onclick="event.stopPropagation()">
          <div class="cal-modal-header"><h2 id="calModalTitle">New Event</h2><button class="cal-modal-close" onclick="window.calModal.close()" aria-label="Close new event dialog">×</button></div>
          <div class="cal-modal-body">
            <div class="cal-modal-field"><label for="calEventTitle">Title</label><input type="text" id="calEventTitle" placeholder="Event title" required></div>
            <div class="cal-modal-field"><label for="calEventDate">Date</label><input type="date" id="calEventDate" value="${dateStr}" required></div>
            <div class="cal-modal-row">
              <div class="cal-modal-field"><label for="calEventTime">Start Time</label><input type="time" id="calEventTime" value="09:00"></div>
              <div class="cal-modal-field"><label for="calEventEndTime">End Time</label><input type="time" id="calEventEndTime" value="10:00"></div>
            </div>
            <div class="cal-modal-field"><label for="calEventDescription">Description</label><textarea id="calEventDescription" rows="3" placeholder="Event description"></textarea></div>
            <fieldset class="cal-modal-field"><legend>Color</legend><div class="cal-color-picker">
              ${['#6395ff','#22c55e','#f59e0b','#ef4444','#a855f7','#14b8a6'].map(c =>
                `<button type="button" class="cal-color-option" aria-label="Select ${c} event color" style="background:${c}" data-color="${c}" onclick="document.querySelectorAll('.cal-color-option').forEach(el=>el.classList.remove('selected')); this.classList.add('selected');"></button>`
              ).join('')}
            </div></fieldset>
          </div>
          <div class="cal-modal-footer">
            <button class="cal-modal-btn cal-modal-cancel" onclick="window.calModal.close()">Cancel</button>
            <button class="cal-modal-btn cal-modal-save" onclick="window.calModal.saveEvent()">Create Event</button>
          </div>
        </div>
      </div>`;
    this._show(html);
  }

  openEditEvent(event, options) {
    options = options || {};
    var action = ['calendar_edit','calendar_drag_drop','calendar_resize'].includes(options.action)
      ? options.action : 'calendar_edit';
    var labels = {
      calendar_edit: { title:'Edit schedule', verb:'Approve schedule edit' },
      calendar_drag_drop: { title:'Confirm moved schedule', verb:'Approve schedule move' },
      calendar_resize: { title:'Confirm resized schedule', verb:'Approve schedule resize' }
    };
    var proposal = options.proposal || {};
    var start = new Date(event.rawScheduledStart);
    var end = new Date(event.rawScheduledEnd);
    var date = proposal.date || event.date || (!Number.isNaN(start.getTime()) ? this._formatDate(start) : '');
    var time = proposal.time || event.timeValue || (!Number.isNaN(start.getTime()) ? calendarTimeValue(start) : '09:00');
    var endDate = proposal.endDate || event.endDate || (!Number.isNaN(end.getTime()) ? this._formatDate(end) : date);
    var endTime = proposal.endTime || event.endTimeValue || (!Number.isNaN(end.getTime()) ? calendarTimeValue(end) : '10:00');
    var reasons = {
      calendar_edit: 'Human-approved Calendar schedule edit.',
      calendar_drag_drop: 'Human-approved Calendar drag and drop.',
      calendar_resize: 'Human-approved Calendar resize.'
    };
    this.editContext = { id:String(event.id), action:action, returnFocusId:String(event.id) };
    this.pendingReturnFocus = options.returnFocus || document.activeElement;
    const html = `
      <div class="cal-modal-overlay" id="calModalOverlay" onclick="window.calModal.close()">
        <div class="cal-modal" role="dialog" aria-modal="true" aria-labelledby="calModalTitle" aria-describedby="calScheduleCurrent" onclick="event.stopPropagation()">
          <div class="cal-modal-header"><h2 id="calModalTitle">${labels[action].title}</h2><button type="button" class="cal-modal-close" onclick="window.calModal.close()" aria-label="Cancel schedule change">×</button></div>
          <div class="cal-modal-body">
            <p class="cal-current-schedule" id="calScheduleCurrent"><strong>Current schedule:</strong> ${escapeCalendarMarkup(calendarScheduleLabel(event))}</p>
            <p class="cal-schedule-notice">This change requires your explicit approval and will be checked against revision ${escapeCalendarMarkup(event.scheduleAuthority && event.scheduleAuthority.revision)}.</p>
            <div class="cal-modal-row">
              <div class="cal-modal-field"><label for="calEventDate">Start date</label><input type="date" id="calEventDate" value="${escapeCalendarMarkup(date)}" required></div>
              <div class="cal-modal-field"><label for="calEventTime">Start time</label><input type="time" id="calEventTime" value="${escapeCalendarMarkup(time)}" required></div>
            </div>
            <div class="cal-modal-row">
              <div class="cal-modal-field"><label for="calEventEndDate">End date</label><input type="date" id="calEventEndDate" value="${escapeCalendarMarkup(endDate)}" required></div>
              <div class="cal-modal-field"><label for="calEventEndTime">End time</label><input type="time" id="calEventEndTime" value="${escapeCalendarMarkup(endTime)}" required></div>
            </div>
            <div class="cal-modal-field"><label for="calScheduleReason">Approval reason</label><textarea id="calScheduleReason" rows="2" maxlength="1000" required>${escapeCalendarMarkup(reasons[action])}</textarea></div>
            <label class="cal-approval-confirm"><input type="checkbox" id="calScheduleConfirmed" onchange="window.calModal.toggleApproval()"> I reviewed the proposed schedule and approve this ${action === 'calendar_drag_drop' ? 'move' : action === 'calendar_resize' ? 'resize' : 'edit'}.</label>
            <div class="cal-schedule-status" id="calScheduleStatus" role="status" aria-live="polite" tabindex="-1">${escapeCalendarMarkup(options.message || '')}</div>
          </div>
          <div class="cal-modal-footer">
            <button type="button" class="cal-modal-btn cal-modal-cancel" onclick="window.calModal.close()">Cancel</button>
            <button type="button" class="cal-modal-btn cal-modal-save" id="calScheduleApprove" onclick="window.calModal.saveEdit()" disabled>${labels[action].verb}</button>
          </div>
        </div>
      </div>`;
    this._show(html);
  }

  _show(html) {
    const existing = document.getElementById('calModalOverlay');
    if (existing) existing.remove();
    if (this.boundKeyDown) document.removeEventListener('keydown', this.boundKeyDown);
    this.boundKeyDown = null;
    if (!this.previouslyFocused) this.previouslyFocused = this.pendingReturnFocus || document.activeElement;
    this.pendingReturnFocus = null;
    const div = document.createElement('div');
    div.innerHTML = html;
    document.body.appendChild(div.firstElementChild);
    const opts = document.querySelectorAll('.cal-color-option');
    if (opts.length > 0 && !document.querySelector('.cal-color-option.selected')) opts[0].classList.add('selected');
    this.boundKeyDown = (event) => {
      if (event.key === 'Escape') {
        this.close();
        return;
      }
      if (event.key !== 'Tab') return;
      const dialog = document.querySelector('.cal-modal[role="dialog"]');
      if (!dialog) return;
      const focusable = Array.from(dialog.querySelectorAll('button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', this.boundKeyDown);
    const firstField = document.getElementById('calEventTitle') || document.getElementById('calEventDate');
    if (firstField) firstField.focus();
  }

  close() {
    const o = document.getElementById('calModalOverlay');
    if (o) o.remove();
    if (this.boundKeyDown) document.removeEventListener('keydown', this.boundKeyDown);
    this.boundKeyDown = null;
    if (this.previouslyFocused && document.contains(this.previouslyFocused)) {
      this.previouslyFocused.focus();
    } else if (this.editContext && this.editContext.returnFocusId) {
      var escapedId = CSS.escape(this.editContext.returnFocusId);
      var replacement = document.querySelector('[data-calendar-event-action="edit"][data-calendar-event-id="' + escapedId + '"]') ||
        document.querySelector('[data-calendar-event-action="resize"][data-calendar-event-id="' + escapedId + '"]');
      if (replacement) replacement.focus();
    }
    this.previouslyFocused = null;
    this.editContext = null;
  }

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

  toggleApproval() {
    var checkbox = document.getElementById('calScheduleConfirmed');
    var approve = document.getElementById('calScheduleApprove');
    if (approve) approve.disabled = !checkbox || !checkbox.checked;
  }

  _setScheduleBusy(busy) {
    var overlay = document.getElementById('calModalOverlay');
    if (!overlay) return;
    overlay.querySelectorAll('input,textarea,button').forEach(function(control) {
      control.disabled = Boolean(busy);
    });
    if (!busy) this.toggleApproval();
    var dialog = overlay.querySelector('[role="dialog"]');
    if (dialog) dialog.setAttribute('aria-busy', String(Boolean(busy)));
  }

  _setScheduleStatus(message, alert) {
    var status = document.getElementById('calScheduleStatus');
    if (!status) return;
    status.textContent = message;
    status.setAttribute('role', alert ? 'alert' : 'status');
    if (alert) status.focus({ preventScroll:true });
  }

  _getScheduleData() {
    var data = {
      date: document.getElementById('calEventDate')?.value,
      time: document.getElementById('calEventTime')?.value,
      endDate: document.getElementById('calEventEndDate')?.value,
      endTime: document.getElementById('calEventEndTime')?.value,
      reason: document.getElementById('calScheduleReason')?.value.trim(),
      action: this.editContext && this.editContext.action
    };
    if (!data.date || !data.time || !data.endDate || !data.endTime || !data.reason) return null;
    return data;
  }

  async saveEdit() {
    var context = this.editContext;
    var confirmed = document.getElementById('calScheduleConfirmed');
    var data = this._getScheduleData();
    if (!context || !confirmed || !confirmed.checked || !data) {
      this._setScheduleStatus('Complete every schedule field, provide a reason, and confirm your approval.', true);
      return;
    }
    this._setScheduleBusy(true);
    this._setScheduleStatus('Checking the current authority and saving your approval…', false);
    var result = await window.calData.updateEvent(context.id, data);
    if (result.ok) {
      await window.refreshCalendar();
      this._setScheduleStatus('Schedule approved and refreshed.', false);
      window.setTimeout(function() { window.calModal.close(); }, 300);
      return;
    }
    if (result.status === 409 || result.code === 'M22_STALE_APPROVAL') {
      await window.refreshCalendar();
      var fresh = window.calState.events.find(function(event) { return String(event.id) === context.id; });
      if (fresh) {
        this.openEditEvent(fresh, {
          action: context.action,
          message: 'The schedule changed before approval. Review the refreshed current schedule and confirm again.'
        });
        this._setScheduleStatus('The schedule changed before approval. Review the refreshed current schedule and confirm again.', true);
        return;
      }
    }
    this._setScheduleBusy(false);
    var prefix = result.status === 403 ? 'You no longer have permission to approve this schedule. ' : '';
    this._setScheduleStatus(prefix + result.message, true);
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

window.openEventModal = function() {
  const selected = calState.selectedDate
    ? new Date(calState.selectedDate + 'T12:00:00')
    : new Date();
  calModal.openCreateEvent(selected);
};

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
      timeValue: start && !isNaN(start.getTime()) ? calendarTimeValue(start) : null,
      endDate: end && !isNaN(end.getTime()) ? calState._formatDate(end) : null,
      endTimeValue: end && !isNaN(end.getTime()) ? calendarTimeValue(end) : null,
      rawScheduledStart: record.scheduledStart || null,
      rawScheduledEnd: record.scheduledEnd || null,
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
      scheduleAuthority: record.scheduleAuthority,
      readOnly: true
    };
  });
};

window.refreshCalendar = async function() {
  calRenderer.setLoading(true);
  calRenderer.render();
  try {
    await calData.fetchEvents();
    calState.events = calData.readAuthorizedEvents();
    calRenderer.setLoading(false);
  } catch(e) {
    calState.events = [];
    calRenderer.setRejected();
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

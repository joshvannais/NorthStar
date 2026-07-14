/**
 * Calendar Engine — Phase 1
 * Dispatch-ready calendar architecture with pluggable view renderers.
 * Event interface: { id, title, date, time, endTime, description, color, type, leadId, ... }
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
    this.renderSidebar();
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
    const conversion = total > 0 ? Math.round((leadEvents.length / total) * 100) : 0;

    this.kpiBar.innerHTML = `
      <div class="cal-kpi-item">
        <span class="cal-kpi-value">${monthEvents.length}</span>
        <span class="cal-kpi-label">Appointments this month</span>
      </div>
      <div class="cal-kpi-divider"></div>
      <div class="cal-kpi-item">
        <span class="cal-kpi-value">${todayEvents.length}</span>
        <span class="cal-kpi-label">Today</span>
      </div>
      <div class="cal-kpi-divider"></div>
      <div class="cal-kpi-item">
        <span class="cal-kpi-value">${total}</span>
        <span class="cal-kpi-label">Total events</span>
      </div>
      <div class="cal-kpi-divider"></div>
      <div class="cal-kpi-item">
        <span class="cal-kpi-value">${conversion}%</span>
        <span class="cal-kpi-label">Lead conversion</span>
      </div>
    `;
  }

  renderMonth() {
    if (!this.container) return;
    const daysInMonth = this.state.getDaysInMonth();
    const firstDay = this.state.getFirstDayOfMonth();
    const monthEvents = this.state.getEventsForMonth();

    let html = '<div class="cal-month-grid">';
    // Day headers
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    dayNames.forEach(d => {
      html += `<div class="cal-month-day-header">${d}</div>`;
    });

    // Empty cells before first day
    for (let i = 0; i < firstDay; i++) {
      html += '<div class="cal-month-cell cal-month-cell-empty"></div>';
    }

    // Day cells
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
          const color = e.color || '#3b82f6';
          const title = e.title || 'Event';
          html += `<div class="cal-month-event-dot" style="background:${color}" title="${title}"></div>`;
        });
        if (dayEvents.length > 3) {
          html += `<span class="cal-month-event-more">+${dayEvents.length - 3} more</span>`;
        }
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

    let html = '<div class="cal-week-view">';
    // Time column + day columns
    html += '<div class="cal-week-grid">';
    // Header row
    html += '<div class="cal-week-row cal-week-header">';
    html += '<div class="cal-week-time-header"></div>';
    days.forEach(d => {
      const dayName = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d.getDay()];
      const dayNum = d.getDate();
      const dateStr = this.state._formatDate(d);
      const isToday = this.state.isToday(d);
      html += `<div class="cal-week-day-header ${isToday ? 'cal-week-day-header-today' : ''}">${dayName} ${dayNum}</div>`;
    });
    html += '</div>';

    // Time slots (6 AM - 10 PM)
    for (let hour = 6; hour <= 21; hour++) {
      const timeLabel = hour <= 12 ? `${hour} AM` : `${hour - 12} PM`;
      if (hour === 12) timeLabel.replace('0 AM', '12 PM');
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

    // Time slots (6 AM - 10 PM)
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
      html += '<div class="cal-agenda-empty">No events scheduled. Click a day to create one.</div>';
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
    this.container.innerHTML = html;
  }

  renderSidebar() {
    if (!this.sidebar) return;
    const today = new Date();
    const todayStr = this.state._formatDate(today);
    const selectedDate = this.state.selectedDate || today;
    const selectedStr = this.state._formatDate(selectedDate);
    const dayEvents = this.state.events.filter(e => e.date === selectedStr);

    // Mini month
    let miniHtml = '<div class="cal-sidebar-section">';
    miniHtml += '<div class="cal-mini-header">';
    miniHtml += `<button class="cal-mini-nav" onclick="window.calState.navigate(-1)">‹</button>`;
    miniHtml += `<span class="cal-mini-label">${selectedDate.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}</span>`;
    miniHtml += `<button class="cal-mini-nav" onclick="window.calState.navigate(1)">›</button>`;
    miniHtml += '</div>';
    miniHtml += '<div class="cal-mini-grid">';
    const miniDayNames = ['S','M','T','W','T','F','S'];
    miniDayNames.forEach(d => { miniHtml += `<div class="cal-mini-day-header">${d}</div>`; });
    const firstDay = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1).getDay();
    const daysInMonth = new Date(selectedDate.getFullYear(), selectedDate.getMonth() + 1, 0).getDate();
    for (let i = 0; i < firstDay; i++) { miniHtml += '<div class="cal-mini-cell cal-mini-empty"></div>'; }
    for (let d = 1; d <= daysInMonth; d++) {
      const date = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), d);
      const dateStr = this.state._formatDate(date);
      const isToday = dateStr === todayStr;
      const isSelected = dateStr === selectedStr;
      let cls = 'cal-mini-cell';
      if (isToday) cls += ' cal-mini-today';
      if (isSelected) cls += ' cal-mini-selected';
      miniHtml += `<div class="${cls}" onclick="window.calState.selectDate(new Date(${date.getFullYear()}, ${date.getMonth()}, ${d}))">${d}</div>`;
    }
    miniHtml += '</div></div>';

    // Selected day events
    miniHtml += '<div class="cal-sidebar-section">';
    miniHtml += `<h3 class="cal-sidebar-title">${selectedDate.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}</h3>`;
    if (dayEvents.length === 0) {
      miniHtml += '<p class="cal-sidebar-empty">No events</p>';
    } else {
      dayEvents.forEach(e => {
        miniHtml += `<div class="cal-sidebar-event" onclick="window.calState.selectEvent(window.calState.events.find(ev => ev.id === '${e.id}'))">`;
        miniHtml += `<div class="cal-sidebar-event-dot" style="background:${e.color || '#3b82f6'}"></div>`;
        miniHtml += `<div class="cal-sidebar-event-info">`;
        miniHtml += `<div class="cal-sidebar-event-title">${e.title}</div>`;
        if (e.time) miniHtml += `<div class="cal-sidebar-event-time">${e.time}</div>`;
        miniHtml += `</div></div>`;
      });
    }
    miniHtml += '</div>';

    // Polaris panel
    miniHtml += '<div class="cal-sidebar-section cal-polaris-section">';
    miniHtml += '<h3 class="cal-sidebar-title">POLARIS™ Intelligence</h3>';
    const leadEvents = this.state.events.filter(e => e.type === 'lead');
    const topOpportunity = leadEvents.length > 0 ? leadEvents[0].title : 'No opportunities';
    const pipelineValue = leadEvents.reduce((sum, e) => sum + (parseFloat(e.estimatedPrice) || 0), 0);
    miniHtml += `<div class="cal-polaris-item"><span class="cal-polaris-label">Top Opportunity</span><span class="cal-polaris-value">${topOpportunity}</span></div>`;
    miniHtml += `<div class="cal-polaris-item"><span class="cal-polaris-label">Pipeline Value</span><span class="cal-polaris-value">$${pipelineValue.toLocaleString()}</span></div>`;
    if (leadEvents.length > 0) {
      miniHtml += `<div class="cal-polaris-item"><span class="cal-polaris-label">Focus</span><span class="cal-polaris-value">${leadEvents.length} appointments to follow up</span></div>`;
    }
    miniHtml += '</div>';

    // New event button
    miniHtml += '<button class="cal-new-event-btn" onclick="window.openEventModal()">+ New Event</button>';

    this.sidebar.innerHTML = miniHtml;
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
      const resp = await fetch(`${this.baseUrl}/events`);
      const data = await resp.json();
      return data.events || [];
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
// Initialize
// ================================================================
const calState = new CalendarState();
const calRenderer = new CalendarRenderer(calState);
const calData = new CalendarData();
const calModal = new CalendarModal();

// Expose globals
window.calState = calState;
window.calRenderer = calRenderer;
window.calData = calData;
window.calModal = calModal;

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
    // If lead event, open Customer Drawer
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
    } else if (event.type === 'custom' || !event.type || event.type === 'recurring') {
      calModal.openEditEvent(event);
    }
  }
});

    var DASHBOARD_INIT_LOADED = true;
    // ═══════════════════════════════════════════════════════════════
    // Application State
    // ═══════════════════════════════════════════════════════════════
    var user = JSON.parse(localStorage.getItem('user') || '{}');
    if (user.name) {
      document.getElementById('welcomeMessage').textContent = `Welcome back, ${user.name}! Here's your business overview.`;
    }

    // Dashboard data (live reference to AppStore)
    function getLiveLeads() { if (typeof CommunicationsEngine !== 'undefined' && CommunicationsEngine.getConversations) { return CommunicationsEngine.getConversations(); } return AppStore.getLeads(); }
    function fmtTime(t) { if (!t) return '-'; try { const d = new Date(t); if (!isNaN(d.getTime())) return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); } catch(e) {} return t; }
    // Auto-refresh dashboard when store changes
    EventBus.on('store:changed', function() { try { loadDashboard(); } catch(e) { console.warn('store:changed refresh skipped:', e.message); } });

    // ═══════════════════════════════════════════════════════════════
    // API Fetch Helper — calls backend, falls back to simulated data
    // ═══════════════════════════════════════════════════════════════
    const API_BASE = '/api/v1';
    function getAuthHeaders() {
      const token = localStorage.getItem('token');
      return token ? { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' };
    }
    async function apiFetch(endpoint, params) {
      var url = API_BASE + endpoint;
      if (params) url += '?' + new URLSearchParams(params).toString();
      try {
        var resp = await fetch(url, { headers: getAuthHeaders() });
        if (!resp.ok) { console.warn('[API] ' + endpoint + ' returned ' + resp.status); return null; }
        var json = await resp.json();
        return json.data || json;
      } catch (err) {
        console.warn('[API] Fetch failed for ' + endpoint + ':', err.message);
        return null;
      }
    }

    // ═══════════════════════════════════════════════════════════════
    // Helpers
    // ═══════════════════════════════════════════════════════════════
    // Status rendered via shared StatusPill.render()



    // ═══════════════════════════════════════════════════════════════
    // WIDGET: Daily Brief (V1-02)
    // ═══════════════════════════════════════════════════════════════
    var briefLastRefresh = 0;
    function refreshBrief() {
      const now = Date.now();
      if (now - briefLastRefresh < 60000) {
        NotificationService.show('Please wait 60 seconds before refreshing.', 'warning');
        return;
      }
      briefLastRefresh = now;
      loadDailyBrief();
    }

    async function loadDailyBrief() {
      const skeleton = document.getElementById('briefSkeleton');
      const content = document.getElementById('briefContent');
      const error = document.getElementById('briefError');
      skeleton.style.display = 'block';
      content.style.display = 'none';
      error.style.display = 'none';

      // Try API first

                  // Fallback to simulated data
      setTimeout(() => {
        skeleton.style.display = 'none';
        const allLeads = getLiveLeads();
        const count = allLeads.length;
        const today = allLeads.filter(c => {
          try { const d = new Date(c.receivedAt || c.time); return !isNaN(d.getTime()) && d.toDateString() === new Date().toDateString(); } catch(e) { return false; }
        }).length;
        const appointments = allLeads.filter(c => c.status === 'scheduled').length;
        const pipeline = allLeads.filter(c => c.status === 'new' || c.status === 'contacted' || c.status === 'qualified');
        const totalPipeline = pipeline.reduce((s,c) => s + (c.avgPrice||0), 0);
        const totalRev = allLeads.reduce((s,c) => s + (c.avgPrice||0), 0);
        const hours = new Date().getHours();
        const greeting = hours < 12 ? 'Good morning' : hours < 17 ? 'Good afternoon' : 'Good evening';
        const name = user.name || 'there';
        const highVal = allLeads.sort((a,b) => (b.avgPrice||0) - (a.avgPrice||0))[0];

        // Build a rich text brief with pipeline stats and recent leads
        let body = greeting + ', ' + name + '. ';
        if (today > 0) body += 'NorthStar answered ' + today + ' call' + (today !== 1 ? 's' : '') + ' today';
        if (count > 0 && today > 0) body += ', captured ' + count + ' lead' + (count !== 1 ? 's' : '');
        else if (count > 0) body += 'NorthStar has captured ' + count + ' lead' + (count !== 1 ? 's' : '');
        if (appointments > 0) body += ', and booked ' + appointments + ' appointment' + (appointments !== 1 ? 's' : '');
        body += '. ';
        if (totalPipeline > 0) body += 'Pipeline value: $' + Math.round(totalPipeline).toLocaleString() + '. Average lead value: $' + Math.round(count > 0 ? totalRev / count : 0).toLocaleString() + '. ';
        if (highVal && highVal.avgPrice > 0) {
          body += 'Top opportunity: $' + Math.round(highVal.avgPrice).toLocaleString() + ' ' + (highVal.service || 'job') + ' with ' + (highVal.caller || 'a prospect') + '. ';
          body += 'Follow up with ' + (highVal.caller || 'this lead') + ' to close.';
        } else if (allLeads.length > 0) {
          body += 'Keep an eye on your recent leads - timely follow-up makes the difference.';
        } else {
          body = greeting + ', ' + name + '. Welcome to NorthStar! Once you connect your phone number, I\u0027ll start answering calls and capturing leads for you.';
        }
        document.getElementById('briefBody').innerHTML = '<p>' + body + '</p>';
        document.getElementById('briefTimestamp').textContent = 'Last updated: ' + new Date().toLocaleTimeString('en-US', {hour:'numeric',minute:'2-digit'});
        content.style.display = 'block';
      }, 600);
    }
    // WIDGET: KPI Grid (V1-05)
    // ═══════════════════════════════════════════════════════════════
    var kpiDefinitions = [
      { id:'today_calls', icon:'📞', label:"Today's Communications", format:'int', link:'/dashboard/communications?filter=today', tier:'starter' },
      { id:'new_leads', icon:'👤', label:'New Leads', format:'int', link:'/dashboard/leads?filter=today', tier:'starter' },
      { id:'appointments', icon:'📅', label:'Appointments', format:'int', link:'/dashboard/calendar?filter=today', tier:'starter' },
      { id:'lead_conversion', icon:'📊', label:'Lead Conv.', format:'pct', link:'/dashboard/reports/conversion', tier:'starter' },
      { id:'avg_job_value', icon:'💰', label:'Avg Job Value', format:'cur', link:'/dashboard/reports/job-value', tier:'starter' },
      { id:'avg_call_length', icon:'⏱', label:'Avg Communication Length', format:'dur', link:'/dashboard/communications', tier:'starter' },
      { id:'missed_calls', icon:'🚫', label:'Missed Communications Prev.', format:'int', link:'/dashboard/communications?filter=prevented', tier:'starter' },
      { id:'avg_response_time', icon:'⚡', label:'Avg Response Time', format:'dur', link:'/dashboard/reports/response-time', tier:'pro' },
      { id:'ai_transfer_rate', icon:'🔄', label:'AI Transfer Rate', format:'pct', link:'/dashboard/communications?filter=transferred', tier:'pro' },
    ];

    function loadKpiGrid() {
      const grid = document.getElementById('kpiGrid');
      const total = AnalyticsEngine.total();
      const today = AnalyticsEngine.todayCalls();
      const avgValue = AnalyticsEngine.avgJobValue();

      let html = '';
      kpiDefinitions.forEach(kpi => {
        let value = '—';
        let trend = '';
        switch(kpi.id) {
          case 'today_calls': value = today; trend = today > 0 ? '<span class="ds-trend-up">↑</span>' : ''; break;
          case 'new_leads': value = total; trend = total > 0 ? '<span class="ds-trend-up">↑</span>' : ''; break;
          case 'appointments': value = AnalyticsEngine.appointments(); trend = ''; break;
          case 'lead_conversion': value = AnalyticsEngine.conversionRate(); break;
          case 'avg_job_value': value = avgValue > 0 ? '$'+avgValue.toLocaleString() : '—'; break;
          case 'avg_call_length': value = AnalyticsEngine.avgCallLength(); break;
          case 'missed_calls': value = AnalyticsEngine.missedCalls(); trend = '0'; break;
          case 'avg_response_time': value = AnalyticsEngine.avgResponseTime(); break;
          case 'ai_transfer_rate': value = total > 0 ? Math.round((AnalyticsEngine.qualified()/total)*100)+'%' : '—'; break;
        }
        html += `<div class="ds-kpi-card" onclick="window.location.href=(kpi.link || '#')">
          <div class="ds-kpi-icon" style="background:var(--kpi-${kpi.id}-bg,var(--neutral-50));color:var(--kpi-${kpi.id}-color,var(--neutral-500));">
            <span style="font-size:20px;">${kpi.icon}</span>
          </div>
          <div class="ds-kpi-value">${value}</div>
          <div class="ds-kpi-label">${kpi.label}</div>
          <div class="ds-kpi-trend">${trend}</div>
        </div>`;
      });
      grid.innerHTML = html;
    }

    // ═══════════════════════════════════════════════════════════════
    // WIDGET: Revenue Trends (V1-06) — Simulated chart
    // ═══════════════════════════════════════════════════════════════
    var currentTrendPeriod = '30d';

    function switchTrendPeriod(period) {
      currentTrendPeriod = period;
      document.querySelectorAll('#trendPeriodPills .ds-pill').forEach(p => {
        p.classList.toggle('active', p.dataset.period === period);
      });
      loadTrendChart();
    }

    function loadTrendChart() {
      const skeleton = document.getElementById('chartSkeleton');
      const canvas = document.getElementById('trendChartCanvas');
      const empty = document.getElementById('chartEmpty');
      skeleton.style.display = 'block';
      canvas.style.display = 'none';
      empty.style.display = 'none';

      if (getLiveLeads().length === 0) {
        setTimeout(() => {
          skeleton.style.display = 'none';
          empty.style.display = 'block';
        }, 400);
        return;
      }

      setTimeout(() => {
        skeleton.style.display = 'none';
        // Draw simple chart using canvas
        const ctx = canvas.getContext('2d');
        const dpr = window.devicePixelRatio || 1;
        const rect = canvas.parentElement.getBoundingClientRect();
        const w = rect.width;
        canvas.width = w * dpr;
        canvas.height = 280 * dpr;
        canvas.style.width = w + 'px';
        canvas.style.height = '280px';
        ctx.scale(dpr, dpr);

        const padding = { top: 20, right: 20, bottom: 30, left: 50 };
        const cw = w - padding.left - padding.right;
        const ch = 280 - padding.top - padding.bottom;

        // Background
        ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--neutral-50') || '#f8fafc';
        ctx.fillRect(0, 0, w, 280);

        // Generate data points from actual revenue history
        const trends = AnalyticsEngine.revenueTrends();
        const data = trends.length > 0 ? trends.map(function(t) { return t.revenue; }) : [0];
        // Pad to at least 2 points for display
        while (data.length < 2) data.push(0);

        const points = data.length;
        const maxVal = Math.max.apply(null, data) * 1.1 || 1000;
        const minVal = Math.min.apply(null, data) * 0.9 || 0;

        // Grid lines
        ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--neutral-200') || '#e2e8f0';
        ctx.lineWidth = 1;
        for (let i = 0; i <= 4; i++) {
          const y = padding.top + (ch / 4) * i;
          ctx.beginPath();
          ctx.moveTo(padding.left, y);
          ctx.lineTo(padding.left + cw, y);
          ctx.stroke();
          const val = Math.round(maxVal - (maxVal - minVal) * (i / 4));
          ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--neutral-400') || '#94a3b8';
          ctx.font = '11px Inter, sans-serif';
          ctx.textAlign = 'right';
          ctx.fillText('$' + val.toLocaleString(), padding.left - 8, y + 4);
        }

        // Line
        ctx.beginPath();
        ctx.strokeStyle = '#D4AF37';
        ctx.lineWidth = 2.5;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        data.forEach((val, i) => {
          const x = padding.left + (cw / (points - 1)) * i;
          const y = padding.top + ch - ((val - minVal) / (maxVal - minVal)) * ch;
          i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        });
        ctx.stroke();

        // Gradient fill
        const gradient = ctx.createLinearGradient(0, padding.top, 0, padding.top + ch);
        gradient.addColorStop(0, 'rgba(212, 175, 55, 0.2)');
        gradient.addColorStop(1, 'rgba(212, 175, 55, 0.01)');
        ctx.lineTo(padding.left + cw, padding.top + ch);
        ctx.lineTo(padding.left, padding.top + ch);
        ctx.closePath();
        ctx.fillStyle = gradient;
        ctx.fill();

        // Data points
        data.forEach((val, i) => {
          const x = padding.left + (cw / (points - 1)) * i;
          const y = padding.top + ch - ((val - minVal) / (maxVal - minVal)) * ch;
          ctx.beginPath();
          ctx.arc(x, y, 4, 0, Math.PI * 2);
          ctx.fillStyle = '#D4AF37';
          ctx.fill();
          ctx.beginPath();
          ctx.arc(x, y, 2, 0, Math.PI * 2);
          ctx.fillStyle = 'white';
          ctx.fill();
        });

        canvas.style.display = 'block';
      }, 500);
    }

    // ═══════════════════════════════════════════════════════════════
    // WIDGET: NorthStar Coach (V1-07)
    // ═══════════════════════════════════════════════════════════════
    var coachDismissed = false;

    function loadCoach() {
      if (coachDismissed) {
        document.getElementById('coachContent').style.display = 'none';
        document.getElementById('coachCard').style.display = 'none';
        return;
      }
      const skeleton = document.getElementById('coachSkeleton');
      const content = document.getElementById('coachContent');
      skeleton.style.display = 'block';
      content.style.display = 'none';

      setTimeout(() => {
        skeleton.style.display = 'none';
        const highVal = getLiveLeads().sort((a,b) => (b.avgPrice||0) - (a.avgPrice||0))[0];
        if (highVal && highVal.avgPrice > 500) {
          document.getElementById('coachText').textContent = `Call ${highVal.caller} back — their ${highVal.service||'job'} is estimated at $${(highVal.avgPrice||0).toLocaleString()}. This is your highest-value opportunity right now.`;
          document.getElementById('coachReason').textContent = `💡 Why: This lead has been waiting for follow-up. Responding quickly increases your chance of booking by 60%.`;
        } else if (getLiveLeads().length > 0) {
          document.getElementById('coachText').textContent = `You have ${getLiveLeads().length} lead${getLiveLeads().length!==1?'s':''} to review. Follow up promptly to maximize conversions.`;
          document.getElementById('coachReason').textContent = `💡 Tip: Leads contacted within 5 minutes convert at 9x the rate of those contacted after 30 minutes.`;
        } else {
          document.getElementById('coachText').textContent = `Welcome to NorthStar! Once you connect your phone number, I'll analyze your calls and provide personalized coaching.`;
          document.getElementById('coachReason').textContent = '';
        }
        content.style.display = 'block';
      }, 400);
    }

    function dismissCoach() {
      coachDismissed = true;
      document.getElementById('coachCard').style.display = 'none';
      NotificationService.show('Coach dismissed for now.', 'info');
    }

    // ═══════════════════════════════════════════════════════════════
    // WIDGET: Recent Leads (V1-08)
    // ═══════════════════════════════════════════════════════════════
    function loadRecentLeads() {
      const skeleton = document.getElementById('leadsSkeleton');
      const list = document.getElementById('recentLeadsList');
      const empty = document.getElementById('recentLeadsEmpty');
      skeleton.style.display = 'block';
      list.innerHTML = '';
      empty.style.display = 'none';

      setTimeout(() => {
        skeleton.style.display = 'none';
        const leads = getLiveLeads().slice(0, 5);
        if (leads.length === 0) {
          empty.style.display = 'block';
          return;
        }
        let html = '';
        leads.forEach(l => {
          html += `<div class="ds-list-item" style="cursor:pointer;" onclick="CustomerDrawer.open(getLiveLeads().find(lead => lead.id === '${l.id}') || getLiveLeads().filter(lead => lead.caller === '${l.caller}' && lead.service === '${l.service}')[0])">
            <div class="ds-list-item-icon">👤</div>
            <div class="ds-list-item-content">
              <div class="ds-list-item-title">${l.caller || 'Unknown'}</div>
              <div class="ds-list-item-sub">${l.service || '—'} · ${fmtTime(l.receivedAt || l.time)}</div>
            </div>
            <div>${StatusPill.render(l.status || 'new')}</div>
          </div>`;
        });
        list.innerHTML = html;
      }, 400);
    }

    // ═══════════════════════════════════════════════════════════════
    // WIDGET: Recent Communications (V1-09)
    // ═══════════════════════════════════════════════════════════════
    function loadRecentCalls() {
      const skeleton = document.getElementById('callsSkeleton');
      const list = document.getElementById('recentCallsList');
      const empty = document.getElementById('recentCallsEmpty');
      skeleton.style.display = 'block';
      list.innerHTML = '';
      empty.style.display = 'none';

      setTimeout(() => {
        skeleton.style.display = 'none';
        const calls = getLiveLeads().slice(0, 5);
        if (calls.length === 0) {
          empty.style.display = 'block';
          return;
        }
        let html = '';
        calls.forEach(c => {
          html += `<div class="ds-list-item">
            <div class="ds-list-item-icon">📞</div>
            <div class="ds-list-item-content">
              <div class="ds-list-item-title">${c.caller || 'Unknown'}</div>
              <div class="ds-list-item-sub">${c.service || '—'} · ${fmtTime(c.receivedAt || c.time)}</div>
            </div>
            <div>${StatusPill.render(c.status || 'new')}</div>
          </div>`;
        });
        list.innerHTML = html;
      }, 400);
    }

    // ═══════════════════════════════════════════════════════════════
    // WIDGET: Upcoming Appointments (V1-10)
    // ═══════════════════════════════════════════════════════════════
    function loadAppointments() {
      const skeleton = document.getElementById('apptsSkeleton');
      const list = document.getElementById('appointmentsList');
      const empty = document.getElementById('appointmentsEmpty');
      skeleton.style.display = 'block';
      list.innerHTML = '';
      empty.style.display = 'none';

      setTimeout(() => {
        skeleton.style.display = 'none';
        const appts = getLiveLeads().filter(c => c.status === 'scheduled').slice(0, 5);
        if (appts.length === 0) {
          empty.style.display = 'block';
          return;
        }
        let html = '';
        appts.forEach(a => {
          html += `<div class="ds-list-item">
            <div class="ds-list-item-icon">📅</div>
            <div class="ds-list-item-content">
              <div class="ds-list-item-title">${a.caller || 'Unknown'}</div>
              <div class="ds-list-item-sub">${a.service || '—'} · ${fmtTime(a.receivedAt || a.time)}</div>
            </div>
            <span class="call-status-badge booked">Scheduled</span>
          </div>`;
        });
        list.innerHTML = html;
      }, 400);
    }

    // ═══════════════════════════════════════════════════════════════
    // WIDGET: Analytics Overview (existing feature)
    // ═══════════════════════════════════════════════════════════════
    function loadAnalytics() {
      const total = getLiveLeads().length;
      const scheduled = getLiveLeads().filter(c => c.status === 'scheduled').length;
      const revenue = getLiveLeads().reduce((s,c) => s + (c.avgPrice||0), 0);
      const avgValue = total > 0 ? Math.round(revenue / total) : 0;

      document.getElementById('analyticsCalls').textContent = total;
      document.getElementById('analyticsLeads').textContent = total;
      document.getElementById('analyticsAppts').textContent = scheduled;
      document.getElementById('analyticsAvgValue').textContent = '$' + avgValue.toLocaleString();
      document.getElementById('analyticsCallLength').textContent = total > 0 ? '3:24' : '0:00';
      document.getElementById('analyticsConversion').textContent = total > 0 ? Math.round((scheduled/total)*100) + '%' : '0%';
    }

    // ═══════════════════════════════════════════════════════════════
    // Initial Load
    // ═══════════════════════════════════════════════════════════════
    function loadDashboard() {
      try { renderPolarisCard(); } catch(e) { console.warn('renderPolarisCard:', e.message); }
      try { loadDailyBrief(); } catch(e) { console.warn('loadDailyBrief:', e.message); }
      try { loadKpiGrid(); } catch(e) { console.warn('loadKpiGrid:', e.message); }
      try { loadTrendChart(); } catch(e) { console.warn('loadTrendChart:', e.message); }
      try { loadCoach(); } catch(e) { console.warn('loadCoach:', e.message); }
      try { loadRecentLeads(); } catch(e) { console.warn('loadRecentLeads:', e.message); }
      try { loadRecentCalls(); } catch(e) { console.warn('loadRecentCalls:', e.message); }
      try { loadAppointments(); } catch(e) { console.warn('loadAppointments:', e.message); }
      try { loadAnalytics(); } catch(e) { console.warn('loadAnalytics:', e.message); }
    }

    // ═══════════════════════════════════════════════════════════════
    // Actions: Simulate Lead, Test AI, Call My AI, Coming Soon
    // ══════════════════════════════════════════════════════════════��
    function simulateDemoLead() {
      try {
        // genCall() is already routed through AppStore.addLead + EventBus by
        // the simulator.js wrapper, so we don't call addLead again here (that
        // would create duplicates). genCall returns the normalized lead.
        const lead = genCall();
        PolarisEngine.analyzeLead(lead);
        NotificationService.show("✅ New lead: " + lead.caller + " ($" + (lead.avgPrice||0).toLocaleString() + " estimated)", 'success');
        try { loadDashboard(); } catch(e) { console.warn('dashboard refresh error:', e.message); }
      } catch(e) {
        console.error('simulateDemoLead:', e);
      }
    }

    function openTestAIModal() {
      document.getElementById('testAIModal').style.display = 'flex';
      document.getElementById('testAiInput').value = '';
      document.getElementById('testAiResponse').textContent = 'Your AI\'s response will appear here.';
      document.getElementById('testAiInput').focus();
    }

    function closeTestAIModal(e) {
      if (e && e.target !== e.currentTarget) return;
      document.getElementById('testAIModal').style.display = 'none';
    }

    function testAIResponse() {
      const q = document.getElementById('testAiInput').value.trim();
      if (!q) { NotificationService.show('Please type a question first.', 'warning'); return; }
      const responses = [
        "Thanks for reaching out to NorthStar! I'd be happy to help with that. Let me check with the team and get back to you with a quote. Could you provide your address and preferred time for an estimate?",
        "Great question! We offer competitive pricing for that service. I'd recommend scheduling a free estimate so our team can assess your specific needs. When would work best for you?",
        "I'd be glad to help with that inquiry. Let me take down your details and someone from our team will reach out. What's the best phone number to reach you?",
      ];
      document.getElementById('testAiResponse').innerHTML = '<strong style="color:var(--brand-600);">AI:</strong> ' + responses[Math.floor(Math.random() * responses.length)];
      NotificationService.show('💬 AI response generated.', 'info');
    }

    function openCallMyAIModal() {
      document.getElementById('callMyAIModal').style.display = 'flex';
    }

    function closeCallMyAIModal(e) {
      if (e && e.target !== e.currentTarget) return;
      document.getElementById('callMyAIModal').style.display = 'none';
    }

    function showComingSoon(feature) {
      document.getElementById('comingSoonMessage').textContent = feature + ' is under development and will be available in an upcoming release.';
      document.getElementById('comingSoonModal').style.display = 'flex';
    }

    function closeComingSoon(e) {
      if (e && e.target !== e.currentTarget) return;
      document.getElementById('comingSoonModal').style.display = 'none';
    }

    // ═══════════════════════════════════════════════════════════════
    // Kick off
    // ═══════════════════════════════════════════════════════════════
    // ============================================================
    // POLARIS Revenue Intelligence Card
    // ============================================================
        function renderPolarisCard() {
      PolarisEngine.renderPolarisCard(getLiveLeads());
    }
    // ============================================================
    // Kick off
    // ============================================================
    // Load on DOMContentLoaded, or immediately if the event already fired
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', loadDashboard);
} else {
  loadDashboard();
}
  
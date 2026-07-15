/**
 * Northstar Solutions — API Client
 * Handles all communication with the backend API.
 */

// Detect backend URL — same origin in production, port 3001 in dev
const API_BASE = (function() {
  // If running on port 3000 (static server), use port 3001 for API
  // On Railway, port is empty (HTTPS 443) — use same-origin '/api'
  if (window.location.port === '3000') {
    return 'http://localhost:3001/api';
  }
  return '/api';
})();

const API = {
  base: API_BASE,

  async request(method, path, body) {
    const headers = { 'Content-Type': 'application/json' };
    
    // Attach auth token if available
    const token = localStorage.getItem('token');
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const options = { method, headers };
    if (body) options.body = JSON.stringify(body);

    const res = await fetch(`${this.base}${path}`, options);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  },

  get(path) { return this.request('GET', path); },
  post(path, body) { return this.request('POST', path, body); },
  put(path, body) { return this.request('PUT', path, body); },
  del(path) { return this.request('DELETE', path); },

  async getLeads() { return this.get('/leads'); },
  async getLead(id) { return this.get(`/leads/${id}`); },
  async createLead(data) { return this.post('/leads', data); },
  async updateLead(id, data) { return this.put(`/leads/${id}`, data); },
  async deleteLead(id) { return this.del(`/leads/${id}`); },
  async simulateLead(data) { return this.post('/leads/simulate', data); },
  async health() { return this.get('/health'); },
};

/**
 * Toast notification helper.
 */
function showToast(message, type = 'success') {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = message;
  toast.style.background = type === 'error' ? 'var(--danger)' : 'var(--neutral-900)';
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 3000);
}

/**
 * Format a date string for display.
 */
function formatDate(dateStr) {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
}

/**
 * Get a status badge for a lead.
 */
function getStatusBadge(status) {
  const map = {
    'new': 'badge-new',
    'contacted': 'badge-contacted',
    'scheduled': 'badge-scheduled',
    'completed': 'badge-completed',
  };
  const cls = map[status] || 'badge-new';
  const title = status.charAt(0).toUpperCase() + status.slice(1).toLowerCase();
  return `<span class="badge ${cls}">${title}</span>`;
}
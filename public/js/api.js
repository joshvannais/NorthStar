/**
 * Northstar Solutions — API Client
 * Handles all communication with the backend API.
 */

const API = {
  base: '/api',

  async request(method, path, body) {
    const options = {
      method,
      headers: { 'Content-Type': 'application/json' },
    };
    if (body) options.body = JSON.stringify(body);

    const res = await fetch(`${this.base}${path}`, options);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  },

  get(path) { return this.request('GET', path); },
  post(path, body) { return this.request('POST', path, body); },

  async getLeads() { return this.get('/leads'); },
  async getLead(id) { return this.get(`/leads/${id}`); },
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
  return `<span class="badge ${cls}">${status}</span>`;
}
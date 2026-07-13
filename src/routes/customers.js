/**
 * Customer profiles — persistent storage linked to leads.
 * Extends the existing store pattern. Customers are created when
 * leads are converted. Each customer has a leadId reference.
 */
const fs = require('fs');
const path = require('path');
const express = require('express');
const router = express.Router();

const DATA_FILE = path.join(__dirname, '..', '..', 'data', 'customers.json');

function loadCustomers() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    }
  } catch (e) {
    console.warn('[Customers] Failed to load:', e.message);
  }
  return [];
}

function saveCustomers(customers) {
  try {
    const dir = path.dirname(DATA_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(customers, null, 2));
  } catch (e) {
    console.warn('[Customers] Failed to save:', e.message);
  }
}

function generateId() {
  return 'cust_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// GET /api/customers — list all customers
router.get('/', (req, res) => {
  const customers = loadCustomers();
  const { search, status } = req.query;
  let filtered = customers;
  if (search) {
    const q = search.toLowerCase();
    filtered = filtered.filter(c =>
      c.name.toLowerCase().includes(q) ||
      (c.email && c.email.toLowerCase().includes(q)) ||
      (c.phone && c.phone.includes(q))
    );
  }
  if (status) {
    filtered = filtered.filter(c => c.status === status);
  }
  res.json({ customers: filtered, count: filtered.length });
});

// GET /api/customers/:id — get single customer
router.get('/:id', (req, res) => {
  const customers = loadCustomers();
  const customer = customers.find(c => c.id === req.params.id);
  if (!customer) return res.status(404).json({ error: 'Customer not found' });
  res.json(customer);
});

// POST /api/customers — create customer from lead
router.post('/', (req, res) => {
  const customers = loadCustomers();
  const existing = customers.find(c => c.leadId === req.body.leadId);
  if (existing) return res.status(409).json({ error: 'Customer already exists for this lead', customer: existing });

  const customer = {
    id: generateId(),
    leadId: req.body.leadId || null,
    name: req.body.name || 'Unknown',
    phone: req.body.phone || '',
    email: req.body.email || '',
    address: req.body.address || '',
    status: 'active',
    totalJobs: 0,
    totalRevenue: 0,
    notes: req.body.notes || '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  customers.push(customer);
  saveCustomers(customers);
  res.status(201).json(customer);
});

// PUT /api/customers/:id — update customer
router.put('/:id', (req, res) => {
  const customers = loadCustomers();
  const idx = customers.findIndex(c => c.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Customer not found' });

  customers[idx] = {
    ...customers[idx],
    ...req.body,
    id: customers[idx].id,
    leadId: customers[idx].leadId,
    createdAt: customers[idx].createdAt,
    updatedAt: new Date().toISOString(),
  };
  saveCustomers(customers);
  res.json(customers[idx]);
});

// DELETE /api/customers/:id — remove customer
router.delete('/:id', (req, res) => {
  const customers = loadCustomers();
  const idx = customers.findIndex(c => c.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Customer not found' });
  const removed = customers.splice(idx, 1)[0];
  saveCustomers(customers);
  res.json({ success: true, customer: removed });
});

module.exports = router;

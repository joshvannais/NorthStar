/**
 * User storage for Northstar Solutions.
 * Stores contractors who sign up for the platform.
 * File-based JSON storage — simple, no database needed.
 */

const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function readUsers() {
  ensureDataDir();
  if (!fs.existsSync(USERS_FILE)) {
    fs.writeFileSync(USERS_FILE, JSON.stringify({ users: [] }, null, 2));
    return { users: [] };
  }
  try {
    return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
  } catch {
    return { users: [] };
  }
}

function writeUsers(data) {
  ensureDataDir();
  fs.writeFileSync(USERS_FILE, JSON.stringify(data, null, 2));
}

/**
 * Add a new contractor user.
 */
function addUser({ name, businessName, phone, email, planType }) {
  const data = readUsers();
  const user = {
    id: uuidv4(),
    name: name || businessName || 'Unknown',
    ownerName: name || '',
    businessName: businessName || '',
    email: email || '',
    phone: phone || '',
    planType: planType || 'Trial',
    status: 'trial',
    signupDate: new Date().toISOString(),
    trialEnds: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
    lastPaymentDate: null,
    paymentStatus: 'none', // 'none', 'on_time', 'late', 'missed'
    paymentHistory: [],
    forwardingNumber: '',
    aiActive: false,
  };
  data.users.push(user);
  writeUsers(data);
  return user;
}

/**
 * Get all users.
 */
function getAllUsers() {
  return readUsers().users;
}

/**
 * Get a single user by ID.
 */
function getUser(id) {
  return readUsers().users.find(u => u.id === id) || null;
}

/**
 * Update user fields.
 */
function updateUser(id, fields) {
  const data = readUsers();
  const idx = data.users.findIndex(u => u.id === id);
  if (idx === -1) return null;
  data.users[idx] = { ...data.users[idx], ...fields };
  writeUsers(data);
  return data.users[idx];
}

/**
 * Record a payment for a user.
 */
function recordPayment(userId, amount, status = 'paid') {
  const data = readUsers();
  const idx = data.users.findIndex(u => u.id === userId);
  if (idx === -1) return null;

  const payment = {
    date: new Date().toISOString(),
    amount,
    status,
    period: new Date().toISOString().slice(0, 7),
  };

  data.users[idx].paymentHistory.push(payment);
  data.users[idx].lastPaymentDate = payment.date;
  data.users[idx].paymentStatus = 'on_time';
  writeUsers(data);
  return data.users[idx];
}

module.exports = {
  addUser,
  getAllUsers,
  getUser,
  updateUser,
  recordPayment,
};

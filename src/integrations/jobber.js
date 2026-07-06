/**
 * Jobber Integration Module
 * Handles OAuth 2.0 authentication and API operations for Jobber CRM.
 * 
 * Prerequisites: JOBBER_CLIENT_ID and JOBBER_CLIENT_SECRET environment variables
 * must be set by registering an app at https://developer.getjobber.com/
 */

const https = require('https');
const db = require('../db');

const JOBBER_AUTH_URL = 'https://api.getjobber.com/api/oauth/authorize';
const JOBBER_TOKEN_URL = 'https://api.getjobber.com/api/oauth/token';
const JOBBER_GRAPHQL_URL = 'https://api.getjobber.com/api/graphql';
const JOBBER_API_VERSION = '2024-01-01';

/**
 * Check if Jobber integration is configured (has API credentials)
 */
function isConfigured() {
  return !!(process.env.JOBBER_CLIENT_ID && process.env.JOBBER_CLIENT_SECRET);
}

/**
 * Generate the OAuth 2.0 authorization URL for a contractor to connect their Jobber account.
 */
function getAuthUrl(userId, redirectBase) {
  if (!isConfigured()) return null;
  const clientId = process.env.JOBBER_CLIENT_ID;
  const redirectUri = `${redirectBase}/api/integrations/jobber/callback`;
  const state = Buffer.from(JSON.stringify({ userId })).toString('base64');
  return `${JOBBER_AUTH_URL}?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&state=${state}`;
}

/**
 * Exchange an authorization code for an access token.
 */
function exchangeCode(code, redirectBase) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({
      client_id: process.env.JOBBER_CLIENT_ID,
      client_secret: process.env.JOBBER_CLIENT_SECRET,
      code,
      redirect_uri: `${redirectBase}/api/integrations/jobber/callback`,
      grant_type: 'authorization_code'
    });
    const req = https.request(JOBBER_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': data.length }
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch (e) { reject(new Error('Failed to parse token response')); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

/**
 * Refresh an access token using a refresh token.
 */
function refreshToken(refreshToken) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({
      client_id: process.env.JOBBER_CLIENT_ID,
      client_secret: process.env.JOBBER_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: 'refresh_token'
    });
    const req = https.request(JOBBER_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': data.length }
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch (e) { reject(new Error('Failed to parse token refresh response')); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

/**
 * Execute a GraphQL query against the Jobber API.
 */
function graphql(query, variables, accessToken) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ query, variables });
    const req = https.request(JOBBER_GRAPHQL_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
        'X-Api-Version': JOBBER_API_VERSION,
        'Content-Length': data.length
      }
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch (e) { reject(new Error('Failed to parse GraphQL response')); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

/**
 * Get stored Jobber tokens for a user from the database.
 */
async function getTokens(userId) {
  if (!db.isAvailable()) return null;
  try {
    const result = await db.query(
      'SELECT jobber_access_token, jobber_refresh_token, jobber_token_expires FROM users WHERE id = $1',
      [userId]
    );
    if (result.rows.length === 0) return null;
    const row = result.rows[0];
    if (!row.jobber_access_token) return null;
    return {
      accessToken: row.jobber_access_token,
      refreshToken: row.jobber_refresh_token,
      expiresAt: row.jobber_token_expires
    };
  } catch (err) {
    console.error('[Jobber] Get tokens error:', err.message);
    return null;
  }
}

/**
 * Save Jobber tokens for a user.
 */
async function saveTokens(userId, accessToken, refreshToken, expiresIn) {
  if (!db.isAvailable()) return;
  const expiresAt = new Date(Date.now() + (expiresIn || 3600) * 1000);
  try {
    await db.query(
      'UPDATE users SET jobber_access_token = $1, jobber_refresh_token = $2, jobber_token_expires = $3 WHERE id = $4',
      [accessToken, refreshToken, expiresAt, userId]
    );
  } catch (err) {
    console.error('[Jobber] Save tokens error:', err.message);
  }
}

/**
 * Get a valid access token for a user (refreshes if expired).
 */
async function getValidAccessToken(userId) {
  const tokens = await getTokens(userId);
  if (!tokens) return null;
  
  // Check if token is expired (with 5 min buffer)
  if (tokens.expiresAt && new Date(tokens.expiresAt).getTime() - 300000 < Date.now()) {
    try {
      const refreshed = await refreshToken(tokens.refreshToken);
      if (refreshed.access_token) {
        await saveTokens(userId, refreshed.access_token, refreshed.refresh_token || tokens.refreshToken, refreshed.expires_in);
        return refreshed.access_token;
      }
    } catch (err) {
      console.error('[Jobber] Token refresh failed:', err.message);
      return null;
    }
  }
  return tokens.accessToken;
}

/**
 * Create a client in Jobber from a lead.
 * Returns the Jobber client ID on success.
 */
async function createClient(lead, accessToken) {
  const mutation = `
    mutation CreateClient($input: ClientCreateInput!) {
      clientCreate(input: $input) {
        client {
          id
          firstName
          lastName
        }
        errors {
          message
        }
      }
    }
  `;
  
  const nameParts = (lead.customerName || 'Unknown').split(' ');
  const firstName = nameParts[0] || 'Unknown';
  const lastName = nameParts.slice(1).join(' ') || 'Client';
  
  const variables = {
    input: {
      firstName,
      lastName,
      emails: [{ address: lead.email || '' }],
      phoneNumbers: [{ number: lead.phoneNumber || '' }],
      addresses: [{
        street1: lead.address || '',
        city: lead.city || '',
        province: lead.state || '',
        zip: lead.zip || ''
      }]
    }
  };
  
  const result = await graphql(mutation, variables, accessToken);
  if (result.data?.clientCreate?.client) {
    return result.data.clientCreate.client.id;
  }
  console.error('[Jobber] Create client error:', JSON.stringify(result.errors || result));
  return null;
}

/**
 * Create a job/request in Jobber for a lead.
 * Optionally linked to a client.
 */
async function createJob(lead, clientId, accessToken) {
  const mutation = `
    mutation CreateJob($input: JobCreateInput!) {
      jobCreate(input: $input) {
        job {
          id
          title
        }
        errors {
          message
        }
      }
    }
  `;
  
  const variables = {
    input: {
      clientId,
      title: `${lead.serviceRequested || 'Service'} - ${lead.customerName || 'Lead'}`,
      description: lead.notes || lead.summary || `Lead from NorthStar AI: ${lead.serviceRequested || 'Service needed'}`,
      status: 'UNASSIGNED'
    }
  };
  
  const result = await graphql(mutation, variables, accessToken);
  if (result.data?.jobCreate?.job) {
    return result.data.jobCreate.job.id;
  }
  console.error('[Jobber] Create job error:', JSON.stringify(result.errors || result));
  return null;
}

/**
 * Push a lead to Jobber — creates a client and a job.
 * Returns { clientId, jobId } or null on failure.
 */
async function pushLead(lead, userId) {
  const accessToken = await getValidAccessToken(userId);
  if (!accessToken) {
    console.log('[Jobber] No valid token for user', userId);
    return null;
  }
  
  try {
    const clientId = await createClient(lead, accessToken);
    if (!clientId) return null;
    
    const jobId = await createJob(lead, clientId, accessToken);
    return { clientId, jobId };
  } catch (err) {
    console.error('[Jobber] Push lead error:', err.message);
    return null;
  }
}

/**
 * Disconnect Jobber for a user (clear stored tokens).
 */
async function disconnect(userId) {
  if (!db.isAvailable()) return;
  try {
    await db.query(
      'UPDATE users SET jobber_access_token = NULL, jobber_refresh_token = NULL, jobber_token_expires = NULL WHERE id = $1',
      [userId]
    );
  } catch (err) {
    console.error('[Jobber] Disconnect error:', err.message);
  }
}

/**
 * Get connection status for a user.
 */
async function getStatus(userId) {
  const tokens = await getTokens(userId);
  return {
    connected: !!tokens,
    configured: isConfigured()
  };
}

module.exports = {
  isConfigured,
  getAuthUrl,
  exchangeCode,
  saveTokens,
  getStatus,
  disconnect,
  pushLead
};
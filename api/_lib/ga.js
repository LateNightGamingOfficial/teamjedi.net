// Minimal Google Analytics 4 Data API client (REST, no extra dependencies).
//
// Environment variables (Vercel → Settings → Environment Variables):
//   GA4_PROPERTY_ID           numeric property ID, e.g. 412345678
//                             (GA → Admin → Property details; NOT the G-XXXX ID)
//   GA_SERVICE_ACCOUNT_JSON   the whole JSON key file of a Google Cloud service
//                             account that has "Viewer" access to the property
//   (or instead of the JSON: GA_CLIENT_EMAIL + GA_PRIVATE_KEY)

const crypto = require('crypto');

function credentials() {
  let email = process.env.GA_CLIENT_EMAIL || '';
  let key = process.env.GA_PRIVATE_KEY || '';
  if (process.env.GA_SERVICE_ACCOUNT_JSON) {
    try {
      const j = JSON.parse(process.env.GA_SERVICE_ACCOUNT_JSON);
      email = j.client_email; key = j.private_key;
    } catch { /* fall through to separate vars */ }
  }
  key = key.replace(/\\n/g, '\n');
  const property = String(process.env.GA4_PROPERTY_ID || '').replace(/^properties\//, '').trim();
  return { email, key, property };
}

function isConfigured() {
  const c = credentials();
  return !!(c.email && c.key && /^\d+$/.test(c.property));
}

let tokenCache = { value: '', exp: 0 };

async function accessToken() {
  if (tokenCache.value && Date.now() < tokenCache.exp - 60000) return tokenCache.value;
  const { email, key } = credentials();
  const now = Math.floor(Date.now() / 1000);
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const unsigned = enc({ alg: 'RS256', typ: 'JWT' }) + '.' + enc({
    iss: email,
    scope: 'https://www.googleapis.com/auth/analytics.readonly',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  });
  const sig = crypto.createSign('RSA-SHA256').update(unsigned).sign(key).toString('base64url');
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${unsigned}.${sig}`,
    }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || !data.access_token) throw new Error('Google sign-in failed: ' + (data.error_description || data.error || r.status));
  tokenCache = { value: data.access_token, exp: Date.now() + (data.expires_in || 3600) * 1000 };
  return tokenCache.value;
}

// Runs one report and returns rows as plain objects keyed by the
// dimension/metric names, e.g. { pagePath: '/', screenPageViews: 120 }.
async function runReport(request) {
  const { property } = credentials();
  const token = await accessToken();
  const r = await fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${property}:runReport`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((data.error && data.error.message) || `GA report failed (${r.status})`);
  const dims = (data.dimensionHeaders || []).map((h) => h.name);
  const mets = (data.metricHeaders || []).map((h) => h.name);
  return (data.rows || []).map((row) => {
    const o = {};
    dims.forEach((d, i) => { o[d] = row.dimensionValues[i].value; });
    mets.forEach((m, i) => { o[m] = Number(row.metricValues[i].value) || 0; });
    return o;
  });
}

module.exports = { isConfigured, runReport };

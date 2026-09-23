// Serverless contact-form handler (Vercel Node.js function).
// Sends the form submission through Amazon SES over SMTP with Nodemailer.
//
// Set these as Environment Variables in the Vercel dashboard — never in the repo:
//   SMTP_HOST       e.g. email-smtp.us-east-1.amazonaws.com
//   SMTP_PORT       587 (STARTTLS) or 465 (SSL)
//   SMTP_USER       your Access Key ID (starts with AKIA...)
//   SMTP_PASS       your Secret Access Key. Either kind works:
//                     - an SES "SMTP password" (44 chars) is used as-is
//                     - a regular IAM secret access key (40 chars) is converted
//                       to an SES SMTP password automatically below
//   SMTP_FROM       a sender address verified in SES, e.g. website@teamjedi.net
//   CONTACT_TO      where submissions should be delivered (comma-separate for several)
//   ALLOWED_ORIGIN  optional, e.g. https://teamjedi.net (needed only if the site
//                   is served from a different domain than this function)

const crypto = require('crypto');
const nodemailer = require('nodemailer');

// AWS's documented algorithm for turning an IAM secret access key into an
// SES SMTP password. The region must match the one in SMTP_HOST.
function sesSmtpPassword(secretKey, region) {
  const sign = (key, msg) => crypto.createHmac('sha256', key).update(msg, 'utf8').digest();
  let sig = sign(Buffer.from('AWS4' + secretKey, 'utf8'), '11111111');
  for (const part of [region, 'ses', 'aws4_request', 'SendRawEmail']) sig = sign(sig, part);
  return Buffer.concat([Buffer.from([0x04]), sig]).toString('base64');
}

function smtpPassword() {
  const pass = (process.env.SMTP_PASS || '').trim();
  if (pass.length !== 40) return pass; // already an SES SMTP password
  const match = /email-smtp\.([a-z0-9-]+)\.amazonaws\.com/i.exec(process.env.SMTP_HOST || '');
  if (!match) return pass;
  return sesSmtpPassword(pass, match[1].toLowerCase());
}

const clean = (v, max) => String(v ?? '').trim().slice(0, max);
const oneLine = (v) => v.replace(/[\r\n]+/g, ' '); // blocks header injection
const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);
const escapeHtml = (v) =>
  v.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

module.exports = async (req, res) => {
  const origin = process.env.ALLOWED_ORIGIN;
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  }
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let body = req.body || {};
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }

  // Honeypot filled in = bot. Pretend success so it doesn't retry.
  if (clean(body.website, 200)) return res.status(200).json({ ok: true });

  const name = oneLine(clean(body.name, 120));
  const email = oneLine(clean(body.email, 200));
  const organization = oneLine(clean(body.organization, 200));
  const message = clean(body.message, 5000);

  if (!name || !isEmail(email) || !message) {
    return res.status(400).json({ error: 'Name, a valid email and a message are required.' });
  }

  const port = Number(process.env.SMTP_PORT || 587);
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465, // 465 = implicit TLS; 587/25 = STARTTLS upgrade
    auth: { user: (process.env.SMTP_USER || '').trim(), pass: smtpPassword() },
  });

  const text = [
    `Name: ${name}`,
    `Email: ${email}`,
    `Organization: ${organization || '—'}`,
    '',
    message,
  ].join('\n');

  const html = `
    <p><strong>Name:</strong> ${escapeHtml(name)}<br>
    <strong>Email:</strong> ${escapeHtml(email)}<br>
    <strong>Organization:</strong> ${escapeHtml(organization || '—')}</p>
    <p style="white-space:pre-wrap">${escapeHtml(message)}</p>`;

  try {
    await transporter.sendMail({
      from: `"Team JEDI Website" <${process.env.SMTP_FROM}>`, // must be verified in SES
      to: process.env.CONTACT_TO,
      replyTo: `"${name.replace(/"/g, '')}" <${email}>`,      // hitting Reply answers the visitor
      subject: `Website enquiry from ${name}${organization ? ` (${organization})` : ''}`,
      text,
      html,
    });
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('SMTP send failed:', err);
    return res.status(502).json({ error: 'Could not send message.' });
  }
};

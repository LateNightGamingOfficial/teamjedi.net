#!/usr/bin/env node
// Creates a "bootstrap" account entry for the PORTAL_USERS environment variable.
// Use it once for the first admin; after that, manage accounts at admin.teamjedi.net.
//
//   node scripts/portal-add-user.js
//
// Answer the prompts, then copy the printed JSON into PORTAL_USERS in the
// Vercel dashboard (Settings → Environment Variables). PORTAL_USERS is a JSON
// array, so several accounts look like: [ {...}, {...} ]
// Redeploy after changing it. Removing someone's entry signs them out.

const readline = require('readline');
const { hashPassword, ALL_SECTIONS } = require('../api/_lib/auth');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((r) => rl.question(q, r));

(async () => {
  const email = (await ask('Email: ')).trim().toLowerCase();
  const name = (await ask('Display name: ')).trim();
  const org = (await ask('Organization (optional): ')).trim();
  const password = await ask('Password (12+ characters): ');
  if (password.length < 12) {
    console.error('\nPassword must be at least 12 characters.');
    process.exit(1);
  }
  const s = (await ask(`Sections they can see [${ALL_SECTIONS.join(',')}] (Enter = all): `)).trim();
  const sections = s ? s.split(',').map((x) => x.trim()).filter((x) => ALL_SECTIONS.includes(x)) : ALL_SECTIONS;
  const admin = /^y/i.test((await ask('Your own team member (sees Clarity heatmaps link)? [y/N]: ')).trim());
  rl.close();

  const entry = { email, name: name || email, org, hash: hashPassword(password), sections, admin };
  console.log('\nAdd this entry to the PORTAL_USERS array:\n');
  console.log(JSON.stringify(entry));
})();

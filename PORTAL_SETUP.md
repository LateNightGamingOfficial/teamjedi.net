# Analytics & admin sites: setup

| Site | What it is | Who signs in |
|---|---|---|
| **analytics.teamjedi.net** | The metrics dashboard | Every active account |
| **admin.teamjedi.net** | Add and manage accounts, check setup, see activity | Admin accounts only |

Both are served by the same Vercel project as teamjedi.net (`vercel.json` routes each
hostname). Old links (`teamjedi.net/portal/...`) redirect to the new sites. The "Client
portal" link in the site footer goes to analytics.teamjedi.net.

Everything below is done once, in the Vercel dashboard for this project. Redeploy after
changing environment variables.

## 1. Add the two subdomains

Vercel → Project → Settings → **Domains** → add `analytics.teamjedi.net` and
`admin.teamjedi.net`. Vercel shows a DNS record for each (normally a CNAME to
`cname.vercel-dns.com`); add those at whoever hosts the teamjedi.net DNS. HTTPS
certificates are issued automatically once DNS resolves.

## 2. Sign-in secret

Settings → Environment Variables → `PORTAL_SECRET` = 32+ random characters:

```
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## 3. Account storage (so the admin site can save accounts)

Vercel → **Storage** → Create Database → **Upstash for Redis** (free tier is plenty) →
connect it to this project. That adds `KV_REST_API_URL` and `KV_REST_API_TOKEN`
automatically. Redeploy.

## 4. The first admin account

The admin site needs one admin to exist before anyone can sign in to it. Create that one
in Vercel:

```
node scripts/portal-add-user.js
```

Answer "y" to the admin question, then set `PORTAL_USERS` to the printed entry wrapped in
`[ ]`, e.g. `[{"email":"you@...","name":"...","hash":"scrypt$...","admin":true,...}]`.

After that, sign in at **admin.teamjedi.net** and add everyone else there. Accounts set in
`PORTAL_USERS` show a "Vercel" badge; editing one in the admin site saves an editable copy
that takes over.

## 5. Google Analytics data (real numbers)

1. Google Cloud Console: enable the **Google Analytics Data API**, create a **service
   account**, download a **JSON key**.
2. Google Analytics → Admin → Property access management: add the service account's
   email with the **Viewer** role.
3. Vercel variables: `GA4_PROPERTY_ID` (numeric property ID, not the `G-` one) and
   `GA_SERVICE_ACCOUNT_JSON` (whole key file contents).
4. In the admin site, Setup tab → **Test connection**.

## 6. Custom dimensions (one-time, in Google Analytics)

GA → Admin → Custom definitions → Create custom dimension, scope **Event**:
`section` (parameter `section`) and `percent` (parameter `percent`). They start collecting
from the day they're created.

## How accounts work

- **What they can see**: Visitors & top pages / What people read / Where visitors come from.
- **Admin**: can use admin.teamjedi.net and sees the Clarity link. Give to your own team only.
- **Passwords**: generated (shown once) or set by you; 12+ characters; stored only as a
  scrypt hash. Resetting a password, switching an account off, or "Sign out everywhere"
  ends that person's sessions immediately.
- **Sessions**: 12 hours on analytics, 4 hours on admin. A sign-in on one site doesn't
  sign you in to the other.
- **Protection**: 8 failed sign-ins from one address → 15-minute pause. Admins can't
  remove their own admin access or delete themselves. Every admin sign-in and account
  change is in the Activity tab.

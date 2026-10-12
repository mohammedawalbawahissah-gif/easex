# Deploying EaseX

This is the step-by-step for taking EaseX from local Docker Compose to a
live production deployment, using the stack decided on in
`EaseX Paid Dependencies.xlsx`: Railway (hosting), Cloudflare R2 (media
storage), Resend (email), Cloudflare Registrar (domain), Cloudflare Pages
(web frontend), Hubtel (mobile money, once you're ready to go live with it).

Do these roughly in order — later steps need values produced by earlier
ones.

---

## 1. Buy the domain(s) on Cloudflare

1. Go to <https://dash.cloudflare.com> → **Domain Registration** → **Register Domains**.
2. Register `easex.com` (or whatever you've settled on). ~$10.46/year, at cost.
3. Cloudflare automatically creates a DNS zone for it — you'll add records in step 5.

---

## 2. Create the Cloudflare R2 bucket (media storage)

1. Cloudflare dashboard → **R2 Object Storage** → **Create bucket**.
   Name it `easex-media` (or similar).
2. **Settings** tab → **Public access** → enable **r2.dev subdomain**
   (gives you a public URL immediately; swap in a custom domain later if
   you want `media.easex.com` instead).
3. **Manage API tokens** → **Create API token** → permissions: **Object Read & Write**,
   scoped to this bucket only. Save the three values it gives you:
   - Access Key ID → `R2_ACCESS_KEY_ID`
   - Secret Access Key → `R2_SECRET_ACCESS_KEY`
   - The endpoint shown (`https://<account_id>.r2.cloudflarestorage.com`) → `R2_ENDPOINT_URL`
4. Bucket name → `R2_BUCKET_NAME`. The public r2.dev URL from step 2 → `R2_PUBLIC_BASE_URL`.

---

## 3. Create a Resend account (email)

1. <https://resend.com> → sign up → **API Keys** → create one → `RESEND_API_KEY`.
2. **Domains** → add `easex.com` → add the TXT/MX/DKIM records it gives you
   to the Cloudflare DNS zone from step 1. Wait for it to show "Verified"
   (usually minutes, can take longer) before sending real mail — unverified
   domains get spam-folder treatment.
3. Set `DEFAULT_FROM_EMAIL=noreply@easex.com` (must be on the verified domain).

---

## 4. Railway: backend, Postgres, Redis

1. <https://railway.app> → sign up/log in → **New Project** → **Deploy from GitHub repo**
   → pick your `easex` repo.
2. Railway will try to auto-detect a service from the repo root. Delete that
   auto-created service once it appears — you need three separate services,
   each pointed at the `backend/` subfolder specifically.
3. **Add a service** → **GitHub Repo** → same repo → in its **Settings**:
   - **Root Directory**: `backend`
   - **Name**: `web`
   - Leave Start Command blank (it uses the Dockerfile's `CMD`, which runs
     migrate + collectstatic + gunicorn).
4. **Add a service** again, same repo, **Root Directory**: `backend`, **Name**: `celery_worker`.
   In its Settings → **Deploy** → **Custom Start Command**:
   ```
   celery -A config worker -l info
   ```
5. **Add a service** again, same repo, **Root Directory**: `backend`, **Name**: `celery_beat`.
   Custom Start Command:
   ```
   celery -A config beat -l info
   ```
6. **New** → **Database** → **Add PostgreSQL**. Railway provisions it and
   exposes `DATABASE_URL` automatically to services in the same project
   (reference it as a variable, see step 7).
7. **New** → **Database** → **Add Redis**. Same deal — it exposes `REDIS_URL`.

### Environment variables (set on the `web` service, then click "..." → Copy to other services, or just paste into each of the three)

In each service's **Variables** tab, add:

```
DJANGO_SECRET_KEY=<generate: python -c "from django.core.management.utils import get_random_secret_key; print(get_random_secret_key())">
DJANGO_DEBUG=False
DJANGO_ALLOWED_HOSTS=<your-web-service>.up.railway.app,api.easex.com

DATABASE_URL=${{Postgres.DATABASE_URL}}
REDIS_URL=${{Redis.REDIS_URL}}

FIELD_ENCRYPTION_KEYS=<generate: python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())">
PIN_PEPPER=<a long random string — generate once, never change>
GIFTCARD_FINGERPRINT_KEY=<a different long random string — generate once, never change>
REQUIRE_STAFF_2FA=True
ADMIN_URL=<pick something non-obvious, e.g. ops-7f3k/>

ANTHROPIC_API_KEY=<your key>

EMAIL_PROVIDER=resend
RESEND_API_KEY=<from step 3>
DEFAULT_FROM_EMAIL=noreply@easex.com
FRONTEND_URL=https://easex.com

R2_ACCESS_KEY_ID=<from step 2>
R2_SECRET_ACCESS_KEY=<from step 2>
R2_BUCKET_NAME=<from step 2>
R2_ENDPOINT_URL=<from step 2>
R2_PUBLIC_BASE_URL=<from step 2>

CORS_ALLOWED_ORIGINS=https://easex.com,https://www.easex.com

# Leave Hubtel off until you have real merchant credentials and have tested
# the webhook URL below is reachable:
HUBTEL_ENABLED=False
```

The `${{Postgres.DATABASE_URL}}` and `${{Redis.REDIS_URL}}` syntax is
Railway's variable reference — it autocompletes when you type `${{` in the
Variables editor, and keeps the value in sync if Railway ever rotates it.

**Do this once, by hand, before anything else**: generate
`DJANGO_SECRET_KEY`, `FIELD_ENCRYPTION_KEYS`, `PIN_PEPPER`, and
`GIFTCARD_FINGERPRINT_KEY` locally and paste the actual values in — don't
let Railway or anyone regenerate these later. `PIN_PEPPER` and
`GIFTCARD_FINGERPRINT_KEY` can never change without invalidating existing
users' PINs/2FA and weakening gift-card duplicate detection, per the
comments in `.env.example`.

8. Deploy. Check the `web` service's **Deployments** → logs for migration
   output and confirm it comes up (Railway gives it a
   `<name>.up.railway.app` URL under **Settings** → **Networking** —
   generate one if it isn't there yet).
9. Once it's live, go to Hubtel's merchant dashboard (when you're ready to
   enable it) and set the webhook/callback URLs to:
   - `https://api.easex.com/api/payments/webhooks/hubtel/collection/`
   - `https://api.easex.com/api/payments/webhooks/hubtel/payout/`

   (confirmed against `backend/config/urls.py` — `apps.payments.urls` is
   mounted at `api/payments/`.)

---

## 5. Point your domain at Railway and Cloudflare Pages

In the Cloudflare DNS zone for `easex.com` (**DNS** → **Records**):

| Type  | Name  | Content                                  | Proxy status |
|-------|-------|-------------------------------------------|--------------|
| CNAME | api   | `<your-web-service>.up.railway.app`       | Proxied      |
| CNAME | @ (or www) | (Cloudflare Pages gives you this in step 6) | Proxied |

Then in Railway, `web` service → **Settings** → **Networking** → **Custom
Domain** → add `api.easex.com` and follow its verification step (it may ask
for a CNAME flattening or a specific record — follow what it shows).

---

## 6. Deploy the web frontend to Cloudflare Pages

1. Before building, set the production API URL. In `web/.env.production`
   (new file, not committed if `.env*` is gitignored — check first):
   ```
   VITE_API_URL=https://api.easex.com
   VITE_VAPID_PUBLIC_KEY=<same value as web/.env>
   ```
2. Cloudflare dashboard → **Workers & Pages** → **Create** → **Pages** →
   **Connect to Git** → your repo.
3. Build settings:
   - **Root directory**: `web`
   - **Build command**: `npm run build`
   - **Build output directory**: `dist`
   - Add the same `VITE_API_URL` / `VITE_VAPID_PUBLIC_KEY` as environment
     variables in Pages' own settings (Pages doesn't read `.env.production`
     from the repo automatically the way local Vite does).
4. Deploy. Pages gives you a `*.pages.dev` URL immediately; add
   `easex.com` / `www.easex.com` as a custom domain in Pages' settings — it
   writes the CNAME record into the same Cloudflare zone for you.

---

## 7. Point the mobile app at production

Before your next EAS production build, update `mobile/.env` (or however
you're injecting build-time config) so `EXPO_PUBLIC_API_URL` points at
`https://api.easex.com` instead of a local IP, then rebuild:

```
eas build --platform android --profile production
```

(Using a `production` profile, not `preview` — check `mobile/eas.json` has
one; if not, copy the `preview` profile and point its API URL override at
the production backend.)

---

## 8. Smoke test, in this order

1. `https://api.easex.com/admin/<your ADMIN_URL>/` loads and is styled
   correctly (confirms collectstatic/whitenoise worked).
2. Register a test account on the live web app → confirms DB + migrations.
3. Trigger a password reset → confirms Resend is actually sending (check
   Resend's dashboard **Logs** tab, not just that Django didn't error).
4. Upload a gift card image as that test user → confirms R2 — check the
   file actually appears in the R2 bucket in Cloudflare's dashboard.
5. Only after all four pass, consider turning on `HUBTEL_ENABLED=True` with
   real credentials.

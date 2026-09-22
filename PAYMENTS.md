# Payments: load, withdraw, transfer, schedule, gift-card auto-payment

This document covers the money-movement features added to EaseX and how to run them safely.

## What exists now

| Feature | User-facing | Backend |
|---|---|---|
| **Add money** (GHS via mobile money; crypto via deposit address) | `/wallet/add` · Add money screen | `POST /api/payments/load/`, `GET /api/payments/deposit-address/` |
| **Withdraw** (GHS to saved MoMo account; crypto to an address on a chosen network) | `/wallet/withdraw` | `POST /api/payments/withdraw/` |
| **Send** (any of the 11 currencies, to another EaseX user by username or phone) | `/wallet/send` | `POST /api/payments/transfers/` (+ `/lookup/`) |
| **Schedule** a transfer for later; cancel before it runs | `/wallet/scheduled` | `/api/payments/scheduled-transfers/` |
| **Payout accounts** + opt-in **automatic gift-card payout** | `/payouts` | `/api/payments/destinations/`, `/payout-preference/` |
| **Gift-card auto-payment** (admin-side switch) | Gift card review screen | `PaymentSettings` (Django admin) |

Everything lives in `backend/apps/payments/`. Balances change in exactly one place: `backend/apps/transactions/ledger.py`.

## How money is kept safe

- **One place changes balances** (`ledger.py`), using single-statement `UPDATE ... WHERE balance >= x`. No read-modify-write, so no lost updates. The database also has `CHECK (balance >= 0)` as a last line of defence.
- **Holds.** A withdrawal moves funds `balance -> escrow` at request time, so they can't be spent twice. Settling releases the hold to the outside world; rejecting returns it.
- **Row locks.** Each money operation locks the user row, then wallet rows in a fixed order. Concurrent spends serialise; two people paying each other can't deadlock. (Uses Postgres `FOR NO KEY UPDATE`; plain `FOR UPDATE` deadlocked in testing.)
- **Idempotency.** Every money request carries a key. A double-tap or retry returns the original result.
- **Terminal states are final.** A settled/rejected transaction can't be re-opened (this used to allow a second credit).
- **Transaction PIN** (6 digits) confirms every send, withdrawal and scheduled transfer; the password (+ a 2FA code if on) confirms account changes. See "Security" below.
- **Rolling 24h limits** by KYC tier (crypto valued in GHS), applied to withdrawals, transfers and wallet loads. Flagged/unverified accounts can't send money.
- **Provider failures never double-pay.** An exception from a provider means "unknown", so the withdrawal is parked for a human (`needs_reconciliation`) and never retried automatically.

## Two providers

Set `PAYMENTS_PROVIDER` in `.env`:

- `manual` (default): no gateway. A wallet load waits for an admin to confirm the money arrived ("Confirm received" in the admin Transactions screen). A withdrawal waits for an admin to send it by hand, then "Mark paid". Crypto deposit addresses are unavailable. **This is what to run in production until a gateway is integrated.**
- `stub`: fake instant success for development. It can create money from nothing, so the app **refuses to start** with it when `DJANGO_DEBUG` is off.

To connect a real gateway (Paystack / Flutterwave / Hubtel for MoMo, Breet for crypto), add a class to `apps/payments/providers.py` implementing `PaymentProvider` and return it from `get_provider()`. A webhook handler should call `services.finalize_withdrawal(...)` / `services.apply_collection_result(...)` / `services.credit_crypto_deposit(...)`.

## Turning things on: Django admin -> Payment settings

Everything is conservative by default:

| Setting | Default | Meaning |
|---|---|---|
| Loads / withdrawals / transfers enabled | on | Kill switches, flip during an incident |
| Withdrawal auto-approve up to (GHS) | **0** | 0 = every withdrawal waits for an admin |
| Gift card auto-payment enabled | **off** | On = approving a card credits the seller's wallet immediately |
| Gift card auto-payout up to (GHS) | **0** | 0 = never send to MoMo automatically |
| Auto-payout account cooldown (hours) | 24 | A newly added payout account can't receive automatic payouts yet |
| Manual deposit instructions | empty | Shown to users adding money in manual mode |

## Gift card auto-payment: how it works

Approval is now an **attestation**: the reviewer states the card was redeemed and for how much (`redeemed_confirmed` + `redeemed_value`, in the card's own currency). The server computes the payout as `redeemed_value x the subcategory's rate` (GHS per 1 unit of that currency, rounded down) and ignores anything the seller typed. The rate is locked when the card is submitted.

1. **Auto-payment off (default):** approve -> `verified`; an admin then presses Settle (unchanged workflow).
2. **On:** approve credits the seller's wallet immediately.
3. **On + seller opted in + all guardrails pass:** the proceeds are also sent to their saved MoMo account. Guardrails: opted in, payout account older than the cooldown, amount within the auto-payout cap, no open compliance flag, account not flagged, within their daily limit. If any fails, the money simply stays in their wallet (and they're told why).

**Open-loop prepaid cards (Visa, Mastercard, Amex, Vanilla, Netspend, Green Dot) are never auto-credited or auto-paid**, whatever the global switch says: their subcategories have "allow auto payment" unticked, and an admin settles them by hand. (Legacy submissions with no subcategory are manual too.)

A failed or crashed payout step never undoes the wallet credit; a provider decline returns held funds to the wallet.

## Processes you must run

Scheduled transfers need a clock. Run **exactly one** `celery beat` process in addition to the web app and worker:

```
celery -A config beat -l info
```

`docker-compose.yml` now has a `celery_beat` service. On Railway (or any host), create a separate service with that start command. Without it, scheduled transfers never fire, and approved withdrawals that missed their queue message are never re-queued.

## Tests

```
cd backend
python manage.py test --settings=config.settings_test
```

Uses PostgreSQL (the concurrency tests rely on real row locking and are skipped elsewhere). Contains ~210 tests: ledger, limits, idempotency, every currency, scheduling edge cases, gift-card exploits, auto-payout guardrails, threaded race tests, and the security suite (PIN, lockouts, 2FA replay, session revocation, encryption, card-code reveal, Django-admin 2FA). The Redis tests need `pip install redislite` (or point `CACHE_REDIS_URL` at a real Redis).

## Security

### What protects an account, in layers

| Layer | What it does |
|---|---|
| **Sign-in** | 5 wrong passwords for a username in 15 min locks it (counted per account, shared across workers, and applied to unknown usernames too so it can't reveal which exist). Optional **authenticator-app 2FA** makes sign-in two steps; **staff must have it**. |
| **Transaction PIN** | 6 digits, hashed with a per-user salt **and** a server secret ("pepper"), so a stolen database can't be used to brute-force 1M PINs. 5 wrong PINs lock money-out for 15 min, even for the right PIN. Weak PINs (111111, 123456) are refused. |
| **2FA code on top** | With 2FA on, external withdrawals, payout-account changes, auto-payout changes, PIN changes and password changes also need a fresh code. Internal transfers stay PIN-only. A code can never be used twice. |
| **Sessions** | Password change/reset and 2FA changes sign out every other session (refresh tokens blacklisted; access tokens older than the change refused). The device making the change gets fresh tokens. |
| **Cooling-off** | After a password reset, PIN change or 2FA disable, money can't leave for 24h. A hijacked email inbox can reset a password but can't reset the PIN or 2FA, and can't withdraw for a day. |
| **Staff** | Admin API needs staff **with 2FA**. Django's own `/admin/` also needs the authenticator code, has the same lockout, can be moved with `ADMIN_URL`, and wallet balances there are read-only (they used to be editable, bypassing the ledger). |
| **Gift card codes** | Encrypted at rest (Fernet). Staff see one only through *Reveal*: a fresh 2FA code each time, max 30/hour/reviewer, every reveal audit-logged, hidden after 30s, never in any list/detail API. **Erased the moment the card is approved or rejected**, and after 30 days if never reviewed. Duplicate detection uses a keyed HMAC, not a bare hash. |

### Rollout checklist (do these in order)

1. **Add Redis** to your host (Railway: add a Redis service) and set `REDIS_URL`. The app now refuses to start in production without it.
2. **Generate an encryption key** (command in `.env.example`) and set `FIELD_ENCRYPTION_KEYS`. Back it up somewhere safe. Losing it means stored card codes and 2FA secrets can't be read.
3. **Set `PIN_PEPPER` and `GIFTCARD_FINGERPRINT_KEY`** to long random strings, once. Never change them.
4. Set real SMTP (`EMAIL_BACKEND`, etc.) so password-reset emails actually send.
5. Deploy with **`REQUIRE_STAFF_2FA=False`**, run `python manage.py migrate`, then have each staff member turn on 2FA in the app (Account -> Security) and save their recovery codes.
6. Flip **`REQUIRE_STAFF_2FA=True`** and redeploy. Set `ADMIN_URL` to something unguessable.
7. Existing customers have **no PIN yet**: their first send/withdrawal prompts them to set one. Existing sessions are not logged out by the upgrade.

### Things to know

- A staff member who loses their phone uses a **recovery code** (each works once). If they have none left, another superuser can clear their 2FA from a Django shell; there is intentionally no self-service bypass.
- Card-code reveal needs the reviewer's **2FA**. If you redeem cards on the retailer's website from the photo instead, you can ignore reveal.
- Each authenticator code works once, so right after signing in you may need to wait for the next code before revealing a card.
- Key rotation: put the new Fernet key first (`NEW,OLD`), deploy; old data still decrypts, new data uses the new key. Drop the old key only when nothing depends on it.

## Known gaps / decisions still needed

- **No payment gateway or crypto custody is connected.** See "Two providers".
- **No fees yet.** Withdrawals and transfers are fee-free while crypto withdrawals cost real network fees. A fee proposal is being prepared for your audit; nothing is charged until you approve numbers.
- **No "clawback" window for gift cards.** Consider holding auto-payouts for a period per brand, since some cards are reversed days after redemption.
- **Loading the crypto balance from chain** needs the provider webhook; in dev use `python manage.py simulate_deposit <username> USDT 50`.
- **2FA setup shows the key and an "open in authenticator" link, not a QR code** (avoids adding a dependency to both apps).
- **Redis is now a hard dependency for the API**, not just for Celery: if it is down, rate-limited endpoints error rather than silently skipping the limits (deliberate: failing open would disable lockouts).

## Gift card catalog

The sell screen is driven by the database, not code: **Gift cards -> Brands / Subcategories** in Django admin.

- Seeded by migration `0006` from `apps/giftcards/catalog_data.py` (43 brands, ~160 subcategories, compiled from what the main Nigeria/Ghana exchanges list plus each brand's own region rules). It is *not* every card in the world; add more in admin, no deploy needed.
- A **subcategory** = country/currency x card format (e.g. "USA · E-code", "UK · Physical", "Vanilla · $100–$299"). Each has its own **currency**, **rate** and optional min/max value. Sellers enter the card value in that currency.
- **Rates are not seeded.** A subcategory with no rate shows as unavailable. Set them in the admin list (the Rate column is editable inline) or in bulk:
  `python manage.py set_giftcard_rates --currency USD --rate 12.0` (fills only unpriced ones; `--overwrite` replaces, `--dry-run` previews).
- `python manage.py sync_giftcard_catalog` adds any new entries from `catalog_data.py` and never overwrites your rates, switches or edits.

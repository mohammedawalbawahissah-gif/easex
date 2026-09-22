# EaseX Backend

Django + DRF backend for EaseX — crypto trading and gift card exchange/redemption.

## Apps
- `users` — custom user model with KYC tiering, JWT auth (register/login/me)
- `wallets` — read-only wallet balances, derived from the transaction ledger
- `transactions` — the core ledger; every value movement is a row here
- `giftcards` — gift card submission + the manual review queue (via Django admin)
- `compliance` — audit log (append-only) and suspicious-activity flags
- `notifications` — in-app notifications

## Local setup (Docker — recommended)
```
cp .env.example .env
docker-compose up --build
docker-compose exec backend python manage.py migrate
docker-compose exec backend python manage.py createsuperuser
```
API available at http://localhost:8000/api/, admin at http://localhost:8000/admin/

## Local setup (without Docker)
Requires Postgres and Redis running locally.
```
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env
python manage.py migrate
python manage.py createsuperuser
python manage.py runserver
```

## Key design decisions
- **Wallet balances are never edited directly** — they're recalculated by a signal
  in `apps/transactions/signals.py` whenever a Transaction moves to `settled`.
  If you ever need to fix a balance, fix the transaction, not the wallet.
- **Every Transaction requires a unique `idempotency_key`** — this prevents
  duplicate processing from webhook retries or flaky mobile connections.
- **Gift card codes are stored as SHA-256 hashes**, never raw — `card_code_hash`
  is also used to detect duplicate/reused card submissions.
- **Card review happens in Django Admin** (`GiftCardSubmissionAdmin`) via the
  Approve/Reject actions — this is your fraud review queue.
- **Audit logs are append-only** — the admin explicitly blocks add/change/delete
  outside normal application code paths.

## Still to build
- Breet API integration (crypto on/off-ramp) — likely a new `apps/exchange` app
  or a service module under `apps/transactions/services/`
- KYC provider integration (Smile Identity) for tier upgrades
- Celery tasks for async webhook processing
- Rate limiting tuning once real traffic patterns are known

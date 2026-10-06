FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq-dev gcc \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8000

# Default command — used by the Railway "web" service as-is. The
# celery_worker and celery_beat Railway services override this entirely
# with their own Start Command (see RAILWAY_DEPLOY.md), so migrate/
# collectstatic only ever run once, from the web service.
CMD python manage.py migrate --noinput && \
    python manage.py collectstatic --noinput && \
    gunicorn config.wsgi:application --bind 0.0.0.0:$PORT

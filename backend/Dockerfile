# Public deployment (Africa's Talking sandbox needs a public callback URL).
FROM python:3.12-slim
ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt gunicorn "psycopg[binary]"
COPY . .
RUN python manage.py collectstatic --noinput
CMD ["sh", "-c", "python manage.py migrate --noinput && gunicorn config.wsgi:application --bind 0.0.0.0:${PORT:-8000} --workers 2"]

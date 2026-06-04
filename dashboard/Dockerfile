# Cisco IOS Honeypot Dashboard — Docker image
# Lightweight Python container serving the Flask dashboard

FROM python:3.12-slim

LABEL maintainer="Honeypot_Playground Contributors"
LABEL description="Web dashboard for Cowrie Cisco IOS honeypot monitoring"

WORKDIR /dashboard

# Install Python dependencies
COPY dashboard/requirements-dashboard.txt .
RUN pip install --no-cache-dir -r requirements-dashboard.txt

# Copy application files
COPY dashboard/app.py .
COPY dashboard/schema.sql .
COPY dashboard/static/ static/

# Environment variables
ENV DASHBOARD_DB_FILE=/cowrie/cowrie-git/var/lib/cowrie/dashboard.db
ENV FLASK_APP=app.py

EXPOSE 5000

CMD ["python", "app.py"]

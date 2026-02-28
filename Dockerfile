FROM python:3.9-slim

WORKDIR /app

# Copy requirements and install
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy the entire project to ensure modules are found
COPY . .

# Ensure the app can find the 'backend' package
ENV PYTHONPATH=/app

# Start the application using uvicorn directly
# We use the shell form to allow $PORT substitution
CMD uvicorn backend.main:app --host 0.0.0.0 --port ${PORT:-8000}

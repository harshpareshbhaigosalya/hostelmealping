FROM python:3.9-slim

WORKDIR /app

# Copy requirements and install
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy the entire project
COPY . .

# Set environment variable for Python path to find the 'backend' module
ENV PYTHONPATH=/app

# Start the application
CMD ["python", "backend/main.py"]

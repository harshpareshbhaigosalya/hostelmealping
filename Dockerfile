FROM python:3.9-slim

WORKDIR /app

# Copy and install dependencies
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy all files
COPY . .

# Ensure the root folder is in the python path
ENV PYTHONPATH=/app

# Expose the port (informative only)
EXPOSE 8000

# Start the server using the entry point script
CMD ["python", "run_server.py"]

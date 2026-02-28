FROM python:3.9-slim

WORKDIR /app

# Copy requirements and install
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy all files
COPY . .

# Expose the port (informative only)
EXPOSE 8000

# Start the server using the entry point script
CMD ["python", "server.py"]

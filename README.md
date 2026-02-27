# Hostel Meal Ping

A real-time hostel meal coordination app built with Expo (React Native), FastAPI, and MongoDB.

## Project Structure

- `backend/`: FastAPI server with MongoDB integration.
- `frontend/`: Expo mobile application.

---

## 🚀 Getting Started

### 1. Backend Setup

1. **Install Dependencies**:
   ```bash
   cd backend
   pip install -r requirements.txt
   ```

2. **MongoDB**:
   Ensure MongoDB is running locally on `mongodb://localhost:27017`.

3. **Run Server**:
   ```bash
   uvicorn main:app --host 0.0.0.0 --port 8000 --reload
   ```
   *Note: Using `--host 0.0.0.0` allows your mobile device to connect to the server.*

### 2. Frontend Setup

1. **Install Dependencies**:
   ```bash
   cd frontend
   npm install
   ```

2. **Configure Backend URL**:
   Open `frontend/App.js` and update `API_BASE_URL` with your local machine's IP address:
   ```javascript
   const API_BASE_URL = 'http://YOUR_LOCAL_IP:8000';
   ```

3. **Run App**:
   ```bash
   npx expo start
   ```
   Scan the QR code using the Expo Go app (Android) or Camera app (iOS).

---

## 🛠 Features

- **No Login**: Simple one-time name entry stored locally via `AsyncStorage`.
- **Real-time Notifications**: Uses Expo Push Notification service to alert all users when someone triggers a meal event.
- **Live RSVP**: Instant updates for "Joining" and "Not Coming" lists.
- **Polling Architecture**: Continuously syncs the latest meal status across all devices.
- **Background Support**: Notifications work even if the app is killed or in background.

## 📝 Requirements

- Python 3.9+
- Node.js 18+
- MongoDB Installed and Running
- Physical Device (for Push Notifications)

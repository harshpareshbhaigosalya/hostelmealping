# Hostel Meal Ping 🍱

A real-time hostel meal coordination app built with Expo (React Native), FastAPI, and MongoDB.

## 🚀 Correct Project Structure
- `/` - Project Root (contains App.js, package.json, etc.)
- `backend/` - FastAPI logic and MongoDB integration
- `eas.json` - Expo build configuration for APKs

---

## 🛠 Features
- **No Login**: Enter your name once and start pinging.
- **Real-time Notifications**: Alerts everyone when food is ready!
- **Live RSVP**: See who's joining or skipping in real-time.
- **Production Ready**: Robust error handling to prevent crashes.

---

## 🚀 Deployment Guide (Railway)

### 1. Backend Setup
1. Fork this repo and connect it to **Railway**.
2. Add a **MongoDB service** to your Railway project.
3. Railway should automatically detect the `Procfile` and use the correct port.
4. If your app shows a 502 error, ensure the `MONGO_URL` environment variable is linked from your MongoDB service to your FastAPI service.

### 2. Mobile App (APK) Setup
1. Open `App.js` in the root.
2. Update the `API_BASE_URL` with your Railway production URL (e.g., `https://your-app.up.railway.app`).
3. To build a shareable APK:
   ```bash
   eas build -p android --profile preview
   ```
4. Once the build is finished, download the APK and share it with your friends!

---

## 📝 Troubleshooting
- **White Screen Fix**: The latest version includes "Safe Rendering" (optional chaining) to prevent crashes if the server is down or returning unexpected data.
- **Buttons don't work**: Ensure your Internet is connected and verify that the `API_BASE_URL` in `App.js` points to a live server.
- **No Notifications**: Push notifications require a physical device. Ensure you have granted notification permissions.

---

## 💻 Local Development
1. **Backend**:
   ```bash
   pip install -r backend/requirements.txt
   export MONGO_URL="your_mongodb_url"
   uvicorn backend.main:app --host 0.0.0.0 --port 8000
   ```
2. **Frontend**:
   ```bash
   npm install
   npx expo start
   ```


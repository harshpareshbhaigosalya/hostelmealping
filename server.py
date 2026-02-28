import httpx
import os
import logging
import asyncio
from fastapi import FastAPI, HTTPException, Body, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from datetime import datetime, timedelta
from typing import List, Dict, Optional
from pydantic import BaseModel

# Logging setup for Railway console
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="Hostel Meal Ping API")

# Broadest possible CORS for testing on both localhost:8081 and mobile
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- IN-MEMORY REPLACEMENT FOR DATABASE ---
# This ensures it survives for as long as the server is running
users_db = {} 
active_meal = None

# --- EXPO NOTIFICATION LOGIC ---
EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"

async def broadcast_push(tokens: List[str], title: str, body: str, data: dict = None):
    if not tokens: return
    messages = []
    for token in tokens:
        if token and token.startswith("ExponentPushToken"):
            messages.append({
                "to": token, "title": title, "body": body,
                "data": data or {}, "sound": "default",
                "priority": "high", "categoryIdentifier": "MEAL_INVITATION",
                "channelId": "meal-pings"
            })
    if not messages: return
    async with httpx.AsyncClient() as client:
        try:
            resp = await client.post(EXPO_PUSH_URL, json=messages)
            logger.info(f"Broadcast: {resp.status_code}")
        except Exception as e:
            logger.error(f"Notification error: {e}")

# --- API ROUTES ---

@app.get("/")
async def root():
    return {"status": "online", "message": "Hostel Meal Ping is active", "time": datetime.utcnow().isoformat()}

@app.post("/register")
async def register(name: str = Body(..., embed=True), push_token: str = Body(None, embed=True)):
    users_db[name] = {"token": push_token, "time": datetime.utcnow()}
    logger.info(f"Registered: {name}")
    return {"status": "ok"}

@app.post("/meal")
async def start_meal(meal_type: str = Body(..., embed=True), creator_name: str = Body(..., embed=True)):
    global active_meal
    active_meal = {
        "meal_type": meal_type,
        "creator_name": creator_name,
        "created_at": datetime.utcnow().isoformat(),
        "joining": [],
        "not_coming": [],
        "active": True
    }
    
    # Notify everyone else
    others = [u["token"] for n, u in users_db.items() if u["token"] and n != creator_name]
    if others:
        asyncio.create_task(broadcast_push(
            others, 
            f"🍱 {meal_type} Time!", 
            f"{creator_name} is calling for {meal_type}!", 
            {"meal_type": meal_type, "creator_name": creator_name}
        ))
    return {"status": "ok", "meal": active_meal}

@app.get("/meal/current")
async def get_meal():
    if not active_meal: return {"status": "no_active_meal"}
    return active_meal

@app.post("/meal/rsvp")
async def rsvp(name: str = Body(..., embed=True), status: str = Body(..., embed=True)):
    global active_meal
    if not active_meal: raise HTTPException(status_code=404, detail="No meal running")
    
    if status == "join":
        if name in active_meal["not_coming"]: active_meal["not_coming"].remove(name)
        if name not in active_meal["joining"]: active_meal["joining"].append(name)
    else:
        if name in active_meal["joining"]: active_meal["joining"].remove(name)
        if name not in active_meal["not_coming"]: active_meal["not_coming"].append(name)
    return {"status": "ok"}

# --- GLOBAL ERROR HANDLER ---
@app.exception_handler(Exception)
async def catch_all(request: Request, exc: Exception):
    logger.error(f"Failing request: {request.url} - Error: {exc}")
    return JSONResponse(status_code=500, content={"status": "error", "message": str(exc)})

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port)

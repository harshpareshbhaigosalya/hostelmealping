import httpx
import os
import logging
from fastapi import FastAPI, HTTPException, Body, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from datetime import datetime, timedelta
from typing import List, Dict, Optional
from pydantic import BaseModel

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="Hostel Meal Ping API")

# Aggressive CORS for both Mobile and Web Testing
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- MODELS ---
class UserRegistration(BaseModel):
    name: str
    push_token: Optional[str] = None

class RSVPRequest(BaseModel):
    name: str
    status: str

# In-memory storage (No Database Needed)
memory_users = {} 
memory_meal = None

EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"

async def send_push_notifications(tokens: List[str], title: str, body: str, data: dict = None):
    if not tokens: return
    messages = []
    for token in tokens:
        if token and token.startswith("ExponentPushToken"):
            messages.append({
                "to": token, "title": title, "body": body,
                "data": data or {}, "sound": "default",
                "priority": "high", "categoryIdentifier": "MEAL_INVITATION"
            })
    if not messages: return
    async with httpx.AsyncClient() as client:
        try:
            resp = await client.post(EXPO_PUSH_URL, json=messages)
            logger.info(f"Push response: {resp.status_code}")
        except Exception as e:
            logger.error(f"Push notification failed: {e}")

@app.get("/")
async def health_check():
    return {"status": "ok", "mode": "in-memory", "timestamp": datetime.utcnow()}

@app.post("/register")
async def register_user(user: UserRegistration):
    try:
        registration = {
            "name": user.name,
            "push_token": user.push_token,
            "updated_at": datetime.utcnow().isoformat()
        }
        memory_users[user.name] = registration
        logger.info(f"Registered user: {user.name}")
        return {"status": "success"}
    except Exception as e:
        logger.error(f"Registration error: {e}")
        return JSONResponse(status_code=500, content={"status": "error", "message": str(e)})

@app.post("/meal")
async def create_meal(meal_type: str = Body(..., embed=True), creator_name: str = Body(..., embed=True)):
    global memory_meal
    try:
        memory_meal = {
            "meal_type": meal_type,
            "creator_name": creator_name,
            "created_at": datetime.utcnow().isoformat(),
            "joining": [],
            "not_coming": [],
            "active": True
        }
        
        # Notify others
        tokens = [u["push_token"] for u in memory_users.values() if u.get("push_token") and u["name"] != creator_name]
        if tokens:
            await send_push_notifications(
                tokens, 
                f"{meal_type} Time! 🍱", 
                f"{creator_name} is going for {meal_type}. Joining?",
                {"meal_type": meal_type, "creator_name": creator_name}
            )
        return {"status": "success", "meal": memory_meal}
    except Exception as e:
        logger.error(f"Create meal error: {e}")
        return JSONResponse(status_code=500, content={"status": "error", "message": str(e)})

@app.get("/meal/current")
async def get_current_meal():
    if not memory_meal:
        return {"status": "no_active_meal"}
    return memory_meal

@app.post("/meal/rsvp")
async def rsvp_meal(request: RSVPRequest):
    global memory_meal
    if not memory_meal:
        return JSONResponse(status_code=404, content={"status": "error", "message": "No active meal"})
    
    status_field = "joining" if request.status == "join" else "not_coming"
    other_field = "not_coming" if request.status == "join" else "joining"
    
    if request.name in memory_meal[other_field]:
        memory_meal[other_field].remove(request.name)
    if request.name not in memory_meal[status_field]:
        memory_meal[status_field].append(request.name)
        
    return {"status": "success"}

@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger.error(f"Unhandled error: {exc}")
    return JSONResponse(status_code=500, content={"status": "error", "message": "Internal Server Error"})

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port)

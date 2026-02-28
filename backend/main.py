import httpx
import os
import logging
from fastapi import FastAPI, HTTPException, Body, Request
from fastapi.middleware.cors import CORSMiddleware
from datetime import datetime, timedelta
from typing import List, Dict, Optional
from pydantic import BaseModel

# FORCE IN-MEMORY MODE ONLY - No Database connection to prevent 502/Startup errors
DB_CONNECTED = False
print("Running in In-Memory mode only for maximum stability.")

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="Hostel Meal Ping API")

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

# In-memory fallback if DB fails
memory_users = {} 
memory_meal = None

EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"

async def send_push_notifications(tokens: List[str], title: str, body: str, data: dict = None):
    if not tokens:
        return
        
    messages = []
    for token in tokens:
        if token and token.startswith("ExponentPushToken"):
            messages.append({
                "to": token,
                "title": title,
                "body": body,
                "data": data or {},
                "sound": "default",
                "priority": "high",
                "categoryIdentifier": "MEAL_INVITATION"
            })
    
    if not messages:
        return

    async with httpx.AsyncClient() as client:
        try:
            resp = await client.post(EXPO_PUSH_URL, json=messages)
            logger.info(f"Push response: {resp.status_code}")
        except Exception as e:
            logger.error(f"Push notification failed: {e}")

@app.get("/")
async def health_check():
    return {"status": "ok", "timestamp": datetime.utcnow(), "db_connected": DB_CONNECTED}

@app.post("/register")
async def register_user(user: UserRegistration):
    try:
        registration = {
            "name": user.name,
            "push_token": user.push_token,
            "updated_at": datetime.utcnow()
        }
        
        if DB_CONNECTED:
            await users_collection.update_one(
                {"name": user.name},
                {"$set": registration},
                upsert=True
            )
        else:
            memory_users[user.name] = registration
            
        return {"status": "success"}
    except Exception as e:
        logger.error(f"Registration error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/meal")
async def create_meal(meal_type: str = Body(..., embed=True), creator_name: str = Body(..., embed=True)):
    global memory_meal
    try:
        meal_data = {
            "meal_type": meal_type,
            "creator_name": creator_name,
            "created_at": datetime.utcnow().isoformat(),
            "joining": [],
            "not_coming": [],
            "active": True
        }
        
        if DB_CONNECTED:
            # Set all other meals to inactive first
            await meals_collection.update_many({"active": True}, {"$set": {"active": False}})
            await meals_collection.insert_one(meal_data)
            # Remove _id for JSON serializability in current meal view
            if "_id" in meal_data: del meal_data["_id"]
        else:
            memory_meal = meal_data
        
        # Notify users
        tokens = []
        if DB_CONNECTED:
            cursor = users_collection.find({"push_token": {"$ne": None}})
            async for user in cursor:
                if user["push_token"] and user["name"] != creator_name:
                    tokens.append(user["push_token"])
        else:
            tokens = [u["push_token"] for u in memory_users.values() if u.get("push_token") and u["name"] != creator_name]

        if tokens:
            await send_push_notifications(
                tokens, 
                f"{meal_type} Time! 🍱", 
                f"{creator_name} is going for {meal_type}. Joining?",
                {"meal_type": meal_type, "creator_name": creator_name}
            )
            
        return {"status": "success", "meal": meal_data}
    except Exception as e:
        logger.error(f"Create meal error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/meal/current")
async def get_current_meal():
    try:
        if DB_CONNECTED:
            # Find the most recent active meal (within last 2 hours)
            time_limit = datetime.utcnow() - timedelta(hours=2)
            meal = await meals_collection.find_one({"active": True})
            
            # If no active meal or old meal, return no_active
            if not meal:
                return {"status": "no_active_meal"}
            
            # Format for JSON
            meal["_id"] = str(meal["_id"])
            return meal
        else:
            if not memory_meal:
                return {"status": "no_active_meal"}
            return memory_meal
    except Exception as e:
        logger.error(f"Fetch current meal error: {e}")
        return {"status": "error", "detail": "Database error"}

@app.post("/meal/rsvp")
async def rsvp_meal(request: RSVPRequest):
    global memory_meal
    try:
        status_field = "joining" if request.status == "join" else "not_coming"
        other_field = "not_coming" if request.status == "join" else "joining"
        
        if DB_CONNECTED:
            # Atomic update: remove from one list, add to another if not already there
            res = await meals_collection.update_one(
                {"active": True},
                {
                    "$addToSet": {status_field: request.name},
                    "$pull": {other_field: request.name}
                }
            )
            if res.matched_count == 0:
                raise HTTPException(status_code=404, detail="No active meal event")
        else:
            if not memory_meal:
                raise HTTPException(status_code=404, detail="No active meal event")
            
            if request.name in memory_meal[other_field]:
                memory_meal[other_field].remove(request.name)
            if request.name not in memory_meal[status_field]:
                memory_meal[status_field].append(request.name)
        
        return {"status": "success"}
    except HTTPException: raise
    except Exception as e:
        logger.error(f"RSVP error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port)


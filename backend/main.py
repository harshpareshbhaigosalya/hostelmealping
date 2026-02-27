import httpx
from fastapi import FastAPI, HTTPException, Body
from fastapi.middleware.cors import CORSMiddleware
from datetime import datetime
from typing import List, Dict, Optional
from pydantic import BaseModel

app = FastAPI(title="Hostel Meal Ping API (In-Memory)")

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

# --- IN-MEMORY DATABASE ---
# In a real app, this would be MongoDB. For local PC testing, we use variables.
users = {} # {push_token: {"name": str, "updated_at": datetime}}
current_active_meal = None # Will store a dict

EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"

async def send_push_notifications(tokens: List[str], title: str, body: str, data: dict = None):
    # Only try to send if we have tokens and internet
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
                "ttl": 3600,
                "categoryIdentifier": "MEAL_INVITATION"
            })
    
    if not messages:
        return

    async with httpx.AsyncClient() as client:
        try:
            await client.post(EXPO_PUSH_URL, json=messages)
        except Exception as e:
            print(f"Push notification skipped (likely no tokens or internet): {e}")

@app.post("/register")
async def register_user(user: UserRegistration):
    # In-memory registration
    token = user.push_token or f"local-user-{user.name}"
    users[token] = {"name": user.name, "updated_at": datetime.utcnow(), "push_token": user.push_token}
    return {"status": "success"}

@app.post("/meal")
async def create_meal(meal_type: str = Body(..., embed=True), creator_name: str = Body(..., embed=True)):
    global current_active_meal
    
    # Create new meal in memory
    current_active_meal = {
        "meal_type": meal_type,
        "creator_name": creator_name,
        "created_at": datetime.utcnow(),
        "joining": [],
        "not_coming": [],
        "active": True
    }
    
    # Notify all users who have a real push token
    tokens = [u["push_token"] for u in users.values() if u.get("push_token")]
    
    if tokens:
        await send_push_notifications(
            tokens, 
            f"{meal_type} Time!", 
            f"{creator_name} is going for {meal_type}. Are you coming?",
            {"meal_type": meal_type, "creator_name": creator_name}
        )
        
    return {"status": "success", "meal": meal_type}

@app.get("/meal/current")
async def get_current_meal():
    if not current_active_meal:
        return {"status": "no_active_meal"}
    return current_active_meal

@app.post("/meal/rsvp")
async def rsvp_meal(request: RSVPRequest):
    global current_active_meal
    if not current_active_meal:
        raise HTTPException(status_code=404, detail="No active meal event")
    
    name = request.name
    status = request.status # "join" or "not_coming"
    
    # Remove from both lists first
    if name in current_active_meal["joining"]:
        current_active_meal["joining"].remove(name)
    if name in current_active_meal["not_coming"]:
        current_active_meal["not_coming"].remove(name)
    
    # Add to the correct list
    if status == "join":
        current_active_meal["joining"].append(name)
    else:
        current_active_meal["not_coming"].append(name)
    
    return {"status": "success"}

if __name__ == "__main__":
    import uvicorn
    import os
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port)

from pydantic import BaseModel, Field
from typing import List, Optional
from datetime import datetime

class UserRegistration(BaseModel):
    name: str
    push_token: str

class RSVP(BaseModel):
    name: str
    status: str  # "join" or "not_coming"

class MealEvent(BaseModel):
    meal_type: str  # "Breakfast", "Lunch", "Dinner"
    creator_name: str
    created_at: datetime = Field(default_factory=datetime.utcnow)
    joining: List[str] = []
    not_coming: List[str] = []
    active: bool = True

class RSVPRequest(BaseModel):
    name: str
    status: str

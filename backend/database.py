import os
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv

load_dotenv()

MONGO_URL = os.getenv("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = "hostel_meal_ping"

# Create client with a 5 second timeout so it doesn't hang the server if DB is down
client = AsyncIOMotorClient(MONGO_URL, serverSelectionTimeoutMS=5000)
db = client[DB_NAME]

users_collection = db["users"]
meals_collection = db["meals"]

const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const { MongoClient } = require('mongodb');

const app = express();
const PORT = process.env.PORT || 8000;

// Middleware
app.use(cors());
app.use(express.json());

// --- MONGODB CONNECTION ---
const MONGODB_URI = 'mongodb+srv://mhetmodi_db_user:Gk2SgZWP7fegCEyN@cluster0.smot8y4.mongodb.net/?appName=Cluster0';
const DB_NAME = 'hostelmealping';

let cachedClient = null;
let cachedDb = null;

async function getDb() {
    if (cachedDb) return cachedDb;
    if (!cachedClient) {
        cachedClient = new MongoClient(MONGODB_URI);
        await cachedClient.connect();
        console.log('[MongoDB] Connected successfully');
    }
    cachedDb = cachedClient.db(DB_NAME);
    return cachedDb;
}

// --- EXPO PUSH NOTIFICATION ---
const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

async function sendPushBatch(messages) {
    try {
        const resp = await fetch(EXPO_PUSH_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
            },
            body: JSON.stringify(messages),
        });
        const responseBody = await resp.json();
        console.log(`[Push] Broadcast status: ${resp.status}`, JSON.stringify(responseBody));
    } catch (err) {
        console.error(`[Push] Notification error: ${err.message}`);
    }
}

async function broadcastPush(tokens, title, body, data = {}) {
    if (!tokens || tokens.length === 0) {
        console.log('[Push] No tokens to send to');
        return;
    }

    const validTokens = tokens.filter(t => t && t.startsWith('ExponentPushToken'));
    if (validTokens.length === 0) {
        console.log('[Push] No valid ExponentPushTokens found');
        return;
    }

    console.log(`[Push] Sending to ${validTokens.length} tokens:`, validTokens);

    const makeMessages = (ringNum) => validTokens.map(token => ({
        to: token,
        title,
        body,
        data: { ...data, ringNum },
        sound: 'default',
        priority: 'high',
        categoryIdentifier: 'MEAL_INVITATION',
        channelId: 'meal-pings',
        _contentAvailable: true,
    }));

    // Send 3 bursts of notifications staggered by 2 seconds for a long ring effect
    await sendPushBatch(makeMessages(1));
    setTimeout(() => sendPushBatch(makeMessages(2)), 2000);
    setTimeout(() => sendPushBatch(makeMessages(3)), 4000);
}

// --- API ROUTES ---

// Health check
app.get('/', async (req, res) => {
    try {
        const db = await getDb();
        const userCount = await db.collection('users').countDocuments();
        res.json({
            status: 'online',
            message: 'Hostel Meal Ping is active',
            time: new Date().toISOString(),
            registeredUsers: userCount,
            dbConnected: true,
        });
    } catch (err) {
        res.json({
            status: 'online',
            message: 'Hostel Meal Ping is active (DB not connected)',
            time: new Date().toISOString(),
            dbConnected: false,
            error: err.message,
        });
    }
});

// Debug: list all registered users and their tokens
app.get('/debug/users', async (req, res) => {
    try {
        const db = await getDb();
        const users = await db.collection('users').find({}).toArray();
        res.json({
            count: users.length,
            users: users.map(u => ({
                name: u.name,
                hasToken: !!u.push_token,
                tokenPrefix: u.push_token ? u.push_token.substring(0, 30) + '...' : null,
                registeredAt: u.registeredAt,
            })),
        });
    } catch (err) {
        res.status(500).json({ status: 'error', message: err.message });
    }
});

// Register user
app.post('/register', async (req, res) => {
    try {
        const { name, push_token } = req.body;
        if (!name) {
            return res.status(400).json({ status: 'error', message: 'Name is required' });
        }

        const db = await getDb();
        await db.collection('users').updateOne(
            { name },
            {
                $set: {
                    name,
                    push_token: push_token || null,
                    registeredAt: new Date().toISOString(),
                }
            },
            { upsert: true }
        );

        console.log(`[Register] ${name} (token: ${push_token ? push_token.substring(0, 30) + '...' : 'none'})`);
        res.json({ status: 'ok' });
    } catch (err) {
        console.error(`[Register] Error: ${err.message}`);
        res.status(500).json({ status: 'error', message: err.message });
    }
});

// Create meal
app.post('/meal', async (req, res) => {
    try {
        const { meal_type, creator_name } = req.body;
        if (!meal_type || !creator_name) {
            return res.status(400).json({ status: 'error', message: 'meal_type and creator_name are required' });
        }

        const db = await getDb();

        const meal = {
            meal_type,
            creator_name,
            created_at: new Date().toISOString(),
            joining: [],
            not_coming: [],
            active: true,
        };

        // Replace any existing active meal with this new one
        await db.collection('meals').deleteMany({ active: true });
        await db.collection('meals').insertOne(meal);

        // Get all other users' push tokens
        const otherUsers = await db.collection('users').find({
            name: { $ne: creator_name },
            push_token: { $ne: null, $exists: true },
        }).toArray();

        const otherTokens = otherUsers.map(u => u.push_token).filter(Boolean);
        console.log(`[Meal] ${creator_name} started ${meal_type}. Found ${otherTokens.length} users to notify.`);

        if (otherTokens.length > 0) {
            // Fire-and-forget (don't block the response)
            broadcastPush(
                otherTokens,
                `🍱 ${meal_type} Time!`,
                `${creator_name} is calling for ${meal_type}!`,
                { meal_type, creator_name }
            );
        }

        res.json({ status: 'ok', meal });
    } catch (err) {
        console.error(`[Meal] Error: ${err.message}`);
        res.status(500).json({ status: 'error', message: err.message });
    }
});

// Get current meal
app.get('/meal/current', async (req, res) => {
    try {
        const db = await getDb();
        const meal = await db.collection('meals').findOne({ active: true });

        if (!meal) {
            return res.json({ status: 'no_active_meal' });
        }

        // Don't expose MongoDB _id to client
        const { _id, ...mealData } = meal;
        res.json(mealData);
    } catch (err) {
        console.error(`[MealCurrent] Error: ${err.message}`);
        res.status(500).json({ status: 'error', message: err.message });
    }
});

// RSVP to meal
app.post('/meal/rsvp', async (req, res) => {
    try {
        const { name, status } = req.body;
        if (!name || !status) {
            return res.status(400).json({ status: 'error', message: 'name and status are required' });
        }

        const db = await getDb();
        const meal = await db.collection('meals').findOne({ active: true });

        if (!meal) {
            return res.status(404).json({ status: 'error', message: 'No active meal event' });
        }

        if (status === 'join') {
            await db.collection('meals').updateOne(
                { _id: meal._id },
                {
                    $pull: { not_coming: name },
                    $addToSet: { joining: name },
                }
            );
        } else {
            await db.collection('meals').updateOne(
                { _id: meal._id },
                {
                    $pull: { joining: name },
                    $addToSet: { not_coming: name },
                }
            );
        }

        console.log(`[RSVP] ${name} → ${status}`);
        res.json({ status: 'ok' });
    } catch (err) {
        console.error(`[RSVP] Error: ${err.message}`);
        res.status(500).json({ status: 'error', message: err.message });
    }
});

// --- GLOBAL ERROR HANDLER ---
app.use((err, req, res, next) => {
    console.error(`[Error] ${req.method} ${req.url} - ${err.message}`);
    res.status(500).json({ status: 'error', message: 'Internal server error' });
});

// --- START SERVER (local dev only) ---
if (process.env.VERCEL !== '1') {
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`🚀 Hostel Meal Ping server running on port ${PORT}`);
    });
}

// Export for Vercel serverless
module.exports = app;

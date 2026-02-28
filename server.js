const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 8000;

// Middleware
app.use(cors());
app.use(express.json());

// --- IN-MEMORY STORAGE ---
const usersDb = {};
let activeMeal = null;

// --- EXPO PUSH NOTIFICATION ---
const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

async function broadcastPush(tokens, title, body, data = {}) {
    if (!tokens || tokens.length === 0) return;

    const messages = tokens
        .filter(token => token && token.startsWith('ExponentPushToken'))
        .map(token => ({
            to: token,
            title,
            body,
            data,
            sound: 'default',
            priority: 'high',
            categoryIdentifier: 'MEAL_INVITATION',
            channelId: 'meal-pings',
        }));

    if (messages.length === 0) return;

    try {
        const resp = await fetch(EXPO_PUSH_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(messages),
        });
        console.log(`[Push] Broadcast status: ${resp.status}`);
    } catch (err) {
        console.error(`[Push] Notification error: ${err.message}`);
    }
}

// --- API ROUTES ---

// Health check
app.get('/', (req, res) => {
    res.json({
        status: 'online',
        message: 'Hostel Meal Ping is active',
        time: new Date().toISOString(),
    });
});

// Register user
app.post('/register', (req, res) => {
    try {
        const { name, push_token } = req.body;
        if (!name) {
            return res.status(400).json({ status: 'error', message: 'Name is required' });
        }
        usersDb[name] = { token: push_token || null, time: new Date().toISOString() };
        console.log(`[Register] ${name}`);
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

        activeMeal = {
            meal_type,
            creator_name,
            created_at: new Date().toISOString(),
            joining: [],
            not_coming: [],
            active: true,
        };

        // Notify everyone except the creator
        const otherTokens = Object.entries(usersDb)
            .filter(([name, user]) => user.token && name !== creator_name)
            .map(([, user]) => user.token);

        if (otherTokens.length > 0) {
            // Fire-and-forget (don't block the response)
            broadcastPush(
                otherTokens,
                `🍱 ${meal_type} Time!`,
                `${creator_name} is calling for ${meal_type}!`,
                { meal_type, creator_name }
            );
        }

        res.json({ status: 'ok', meal: activeMeal });
    } catch (err) {
        console.error(`[Meal] Error: ${err.message}`);
        res.status(500).json({ status: 'error', message: err.message });
    }
});

// Get current meal
app.get('/meal/current', (req, res) => {
    try {
        if (!activeMeal) {
            return res.json({ status: 'no_active_meal' });
        }
        res.json(activeMeal);
    } catch (err) {
        console.error(`[MealCurrent] Error: ${err.message}`);
        res.status(500).json({ status: 'error', message: err.message });
    }
});

// RSVP to meal
app.post('/meal/rsvp', (req, res) => {
    try {
        const { name, status } = req.body;
        if (!name || !status) {
            return res.status(400).json({ status: 'error', message: 'name and status are required' });
        }
        if (!activeMeal) {
            return res.status(404).json({ status: 'error', message: 'No active meal event' });
        }

        if (status === 'join') {
            // Remove from not_coming, add to joining
            activeMeal.not_coming = activeMeal.not_coming.filter(n => n !== name);
            if (!activeMeal.joining.includes(name)) {
                activeMeal.joining.push(name);
            }
        } else {
            // Remove from joining, add to not_coming
            activeMeal.joining = activeMeal.joining.filter(n => n !== name);
            if (!activeMeal.not_coming.includes(name)) {
                activeMeal.not_coming.push(name);
            }
        }

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

// --- START SERVER ---
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Hostel Meal Ping server running on port ${PORT}`);
});

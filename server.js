const express = require('express');
const admin = require('firebase-admin');
const app = express();
const port = process.env.PORT || 3000;

// Initialize Firebase Admin SDK with environment variable
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}');
admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: 'https://vrctcg-default-rtdb.firebaseio.com/'
});

const db = admin.database();
const messagesRef = db.ref('messages');
const usersRef = db.ref('users');
const cardsRef = db.ref('cards');

const XOR_KEY = 0x5A;
const SHIFT_VALUE = 42;

function hexDecode(hexString) {
    if (!hexString || hexString.length % 2 !== 0) return '';
    let result = '';
    for (let i = 0; i < hexString.length; i += 2) {
        const hexPair = hexString.substr(i, 2);
        result += String.fromCharCode(parseInt(hexPair, 16));
    }
    return result;
}

function deobfuscate(obfuscatedHex) {
    let result = '';
    for (let i = 0; i < obfuscatedHex.length; i += 2) {
        const hexPair = obfuscatedHex.substr(i, 2);
        let value = parseInt(hexPair, 16);
        let unshifted = (value - SHIFT_VALUE + 256) % 256;
        let unxored = unshifted ^ XOR_KEY;
        result += unxored.toString(16).padStart(2, '0');
    }
    return result;
}

// Helper function to restrict access to VRChat clients
function restrictToVRChat(req, res) {
    const userAgent = req.headers['user-agent'] || '';
    if (!userAgent.includes('VRCUnity') && !userAgent.includes('Unity')) {
        return res.status(403).json({ error: "Access restricted to VRChat" });
    }
    return null;
}

// Main chat endpoint: Auto-register and handle messages
app.get('/', async (req, res) => {
    const restriction = restrictToVRChat(req, res);
    if (restriction) return restriction;

    const obfuscatedUsername = req.query.n || '';
    const obfuscatedPassword = req.query.p || '';
    const encodedUsername = deobfuscate(obfuscatedUsername);
    const encodedPassword = deobfuscate(obfuscatedPassword);
    const username = hexDecode(encodedUsername);
    const password = hexDecode(encodedPassword);
    const msg = req.query.m;

    console.log(`Received: n=${obfuscatedUsername}, p=${obfuscatedPassword}`);
    console.log(`Decoded: username=${username}, password=${password}`);

    if (!username || !password) {
        return res.status(400).json({ error: "Username and password required" });
    }

    try {
        const userSnapshot = await usersRef.child(username).once('value');
        const userData = userSnapshot.val();

        if (!userData) {
            await usersRef.child(username).set({ password });
            console.log(`Registered new user: ${username} with password: ${password}`);
        } else if (userData.password !== password) {
            console.log(`Password mismatch: stored=${userData.password}, sent=${password}`);
            return res.status(403).json({ error: "Invalid password" });
        }

        if (msg) {
            const newMessageRef = messagesRef.push();
            const timestamp = new Date().toISOString();
            await newMessageRef.set({
                user: username,
                msg: msg,
                timestamp: timestamp
            });
            console.log(`Message saved: ${username}: ${msg}`);
        }

        const messagesSnapshot = await messagesRef.once('value');
        const data = messagesSnapshot.val() || {};
        const chatLog = Object.keys(data).map(key => ({
            user: data[key].user,
            msg: data[key].msg,
            timestamp: data[key].timestamp
        }));

        res.json(chatLog);
    } catch (err) {
        console.error("Error:", err);
        res.status(500).json({ error: "Server error" });
    }
});

// Load chat endpoint
app.get('/loadchat', async (req, res) => {
    const restriction = restrictToVRChat(req, res);
    if (restriction) return restriction;

    try {
        const messagesSnapshot = await messagesRef.once('value');
        const data = messagesSnapshot.val() || {};
        const chatLog = Object.keys(data).map(key => ({
            user: data[key].user,
            msg: data[key].msg,
            timestamp: data[key].timestamp
        }));

        res.json(chatLog);
    } catch (err) {
        console.error("Error loading chat:", err);
        res.status(500).json({ error: "Server error" });
    }
});

// Endpoint to get all players' card collections
app.get('/cards', async (req, res) => {
    const restriction = restrictToVRChat(req, res);
    if (restriction) return restriction;

    try {
        const cardsSnapshot = await cardsRef.once('value');
        const cardsData = cardsSnapshot.val() || {};
        res.json(cardsData);
    } catch (err) {
        console.error("Error loading cards:", err);
        res.status(500).json({ error: "Server error" });
    }
});

// Endpoint to update card collection (add/remove cards)
app.get('/updatecards', async (req, res) => {
    const restriction = restrictToVRChat(req, res);
    if (restriction) return restriction;

    const obfuscatedUsername = req.query.n || '';
    const obfuscatedPassword = req.query.p || '';
    const encodedUsername = deobfuscate(obfuscatedUsername);
    const encodedPassword = deobfuscate(obfuscatedPassword);
    const username = hexDecode(encodedUsername);
    const password = hexDecode(encodedPassword);
    const updates = req.query.u;

    if (!username || !password || !updates) {
        return res.status(400).json({ error: "Username, password, and updates required" });
    }

    try {
        const userSnapshot = await usersRef.child(username).once('value');
        const userData = userSnapshot.val();

        if (!userData) {
            await usersRef.child(username).set({ password });
            console.log(`Registered new user: ${username}`);
        } else if (userData.password !== password) {
            console.log(`Password mismatch: stored=${userData.password}, sent=${password}`);
            return res.status(403).json({ error: "Invalid password" });
        }

        // Parse updates: setName:cardId1,cardId2;setName:-cardId1,-cardId2
        const updateEntries = updates.split(';');
        for (const entry of updateEntries) {
            if (!entry) continue;
            const [setName, cardIdsStr] = entry.split(':');
            if (!setName || !cardIdsStr) {
                console.log(`Invalid update entry: ${entry}`);
                continue;
            }
            const cardIds = cardIdsStr.split(',');
            const isRemove = cardIds[0].startsWith('-');
            for (let cardId of cardIds) {
                if (isRemove) {
                    cardId = cardId.substring(1); // Remove '-'
                }
                if (!cardId || isNaN(parseInt(cardId))) {
                    console.log(`Invalid cardId in entry: ${entry}, cardId: ${cardId}`);
                    continue;
                }
                const cardPath = `${username}/${setName}/${cardId}`;
                if (isRemove) {
                    await cardsRef.child(cardPath).remove();
                    console.log(`Removed card: ${cardPath}`);
                } else {
                    await cardsRef.child(cardPath).set({}); // Empty object: card exists
                    console.log(`Added card: ${cardPath}`);
                }
            }
        }

        const userCardsSnapshot = await cardsRef.child(username).once('value');
        const userCards = userCardsSnapshot.val() || {};
        res.json(userCards);
    } catch (err) {
        console.error("Error updating cards:", err);
        res.status(500).json({ error: "Server error" });
    }
});

app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});
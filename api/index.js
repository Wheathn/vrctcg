const express = require('express');
const admin = require('firebase-admin');
const app = express();

app.use(express.json());

// Initialize Firebase Admin SDK
let firebaseInitialized = false;
const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT
    ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
    : {};
try {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        databaseURL: 'https://vrctcg-default-rtdb.firebaseio.com/'
    });
    firebaseInitialized = true;
    console.log('Firebase initialized successfully');
} catch (error) {
    console.error('Firebase initialization error:', error.message);
}

const db = firebaseInitialized ? admin.database() : null;
const messagesRef = db ? db.ref('messages') : null;
const usersRef = db ? db.ref('users') : null;
const cardsRef = db ? db.ref('cards') : null;

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

function restrictToVRChat(req, res) {
    const userAgent = req.headers['user-agent'] || '';
    console.log('User-Agent:', userAgent);
    if (!userAgent.includes('VRCUnity') && !userAgent.includes('Unity')) {
        return res.status(403).json({ error: 'Access restricted to VRChat' });
    }
    return null;
}

// Debug route to test Firebase
app.get('/debug', async (req, res) => {
    if (!firebaseInitialized || !db) {
        return res.status(500).json({ error: 'Firebase not initialized' });
    }
    try {
        await db.ref('test').set({ time: new Date().toISOString() });
        const snapshot = await db.ref('test').once('value');
        res.json({ status: 'Firebase connected', data: snapshot.val() });
    } catch (err) {
        console.error('Debug route error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

app.get('/', async (req, res) => {
    const restriction = restrictToVRChat(req, res);
    if (restriction) return restriction;

    if (!firebaseInitialized || !usersRef || !messagesRef) {
        console.error('Firebase not available for /');
        return res.status(500).json({ error: 'Database unavailable' });
    }

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
        return res.status(400).json({ error: 'Username and password required' });
    }

    try {
        const userSnapshot = await usersRef.child(username).once('value');
        const userData = userSnapshot.val();

        if (!userData) {
            await usersRef.child(username).set({ password });
            console.log(`Registered new user: ${username} with password: ${password}`);
        } else if (userData.password !== password) {
            console.log(`Password mismatch: stored=${userData.password}, sent=${password}`);
            return res.status(403).json({ error: 'Invalid password' });
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
        console.error('Error in /:', err.message);
        res.status(500).json({ error: 'Server error' });
    }
});

app.get('/loadchat', async (req, res) => {
    const restriction = restrictToVRChat(req, res);
    if (restriction) return restriction;

    if (!firebaseInitialized || !messagesRef) {
        console.error('Firebase not available for /loadchat');
        return res.status(500).json({ error: 'Database unavailable' });
    }

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
        console.error('Error in /loadchat:', err.message);
        res.status(500).json({ error: 'Server error' });
    }
});

app.get('/cards', async (req, res) => {
    const restriction = restrictToVRChat(req, res);
    if (restriction) return restriction;

    if (!firebaseInitialized || !cardsRef) {
        console.error('Firebase not available for /cards');
        return res.status(500).json({ error: 'Database unavailable' });
    }

    try {
        const cardsSnapshot = await cardsRef.once('value');
        let cardsData = cardsSnapshot.val() || {};

        for (const username in cardsData) {
            if (cardsData[username].sve && Array.isArray(cardsData[username].sve)) {
                const sveObject = {};
                cardsData[username].sve.forEach((value, index) => {
                    if (value === 'T') {
                        sveObject[index] = 'T';
                    }
                });
                cardsData[username].sve = sveObject;
            }
        }

        res.json(cardsData);
    } catch (err) {
        console.error('Error in /cards:', err.message);
        res.status(500).json({ error: 'Server error' });
    }
});

app.get('/updatecards', async (req, res) => {
    const restriction = restrictToVRChat(req, res);
    if (restriction) return restriction;

    if (!firebaseInitialized || !usersRef || !cardsRef) {
        console.error('Firebase not available for /updatecards');
        return res.status(500).json({ error: 'Database unavailable' });
    }

    const obfuscatedUsername = req.query.n || '';
    const obfuscatedPassword = req.query.p || '';
    const encodedUsername = deobfuscate(obfuscatedUsername);
    const encodedPassword = deobfuscate(obfuscatedPassword);
    const username = hexDecode(encodedUsername);
    const password = hexDecode(encodedPassword);
    const updates = req.query.u;
    const wanted = req.query.w;

    console.log(`[updatecards] Received: username=${username}, updates=${updates}, wanted=${wanted}`);

    if (!username || !password) {
        console.log(`[updatecards] Missing username or password: username=${username}, password=${password}`);
        return res.status(400).json({ error: 'Username and password required' });
    }

    try {
        const userSnapshot = await usersRef.child(username).once('value');
        const userData = userSnapshot.val();

        if (!userData) {
            console.log(`[updatecards] Registering new user: ${username}`);
            await usersRef.child(username).set({ password });
        } else if (userData.password !== password) {
            console.log(`[updatecards] Password mismatch for ${username}: stored=${userData.password}, sent=${password}`);
            return res.status(403).json({ error: 'Invalid password' });
        }

        if (updates) {
            const updateEntries = updates.split(';');
            for (const entry of updateEntries) {
                if (!entry) continue;
                const [setName, cardIdsStr] = entry.split(':');
                if (!setName || !cardIdsStr) {
                    console.log(`[updatecards] Invalid update entry: ${entry}`);
                    continue;
                }
                const cardIds = cardIdsStr.split(',');
                const isRemove = cardIds[0].startsWith('-');
                for (let cardId of cardIds) {
                    if (isRemove) {
                        cardId = cardId.substring(1);
                    }
                    if (!cardId || isNaN(parseInt(cardId))) {
                        console.log(`[updatecards] Invalid cardId in entry: ${entry}, cardId: ${cardId}`);
                        continue;
                    }
                    const cardPath = `${username}/${setName}/${cardId}`;
                    if (isRemove) {
                        console.log(`[updatecards] Attempting to remove card: ${cardPath}`);
                        await cardsRef.child(cardPath).remove();
                        console.log(`[updatecards] Removed card: ${cardPath}`);
                    } else {
                        console.log(`[updatecards] Adding card: ${cardPath}`);
                        await cardsRef.child(cardPath).set('T');
                        console.log(`[updatecards] Added card: ${cardPath}`);
                    }
                }
            }
        }

        if (wanted) {
            const wantedCards = wanted.split(',');
            for (const card of wantedCards) {
                if (!card.includes(':')) {
                    console.log(`[updatecards] Invalid wanted card format: ${card}`);
                    continue;
                }
                const [setName, cardIdStr] = card.split(':');
                if (!setName || !cardIdStr) {
                    console.log(`[updatecards] Invalid wanted card: ${card}`);
                    continue;
                }
                const isRemove = cardIdStr.startsWith('-');
                const cardId = isRemove ? cardIdStr.substring(1) : cardIdStr;
                if (!cardId || isNaN(parseInt(cardId))) {
                    console.log(`[updatecards] Invalid cardId in wanted card: ${card}`);
                    continue;
                }
                const wantedPath = `${username}/wanted/${setName}:${cardId}`;
                if (isRemove) {
                    console.log(`[updatecards] Attempting to remove from wanted list: ${wantedPath}`);
                    const wantedSnapshot = await cardsRef.child(wantedPath).once('value');
                    if (wantedSnapshot.exists()) {
                        await cardsRef.child(wantedPath).remove();
                        console.log(`[updatecards] Successfully removed from wanted list: ${wantedPath}`);
                    } else {
                        console.log(`[updatecards] Card not found in wanted list: ${wantedPath}`);
                    }
                } else {
                    console.log(`[updatecards] Adding to wanted list: ${wantedPath}`);
                    await cardsRef.child(wantedPath).set(true);
                    console.log(`[updatecards] Added to wanted list: ${wantedPath}`);
                }
            }
        }

        console.log(`[updatecards] Fetching all players' card data`);
        const cardsSnapshot = await cardsRef.once('value');
        let cardsData = cardsSnapshot.val() || {};

        for (const user in cardsData) {
            if (cardsData[user].sve && Array.isArray(cardsData[user].sve)) {
                const sveObject = {};
                cardsData[user].sve.forEach((value, index) => {
                    if (value === 'T') {
                        sveObject[index] = 'T';
                    }
                });
                cardsData[user].sve = sveObject;
                await cardsRef.child(`${user}/sve`).set(sveObject);
                console.log(`[updatecards] Normalized sve for user: ${user}`);
            }
        }

        console.log(`[updatecards] Returning cards data for ${Object.keys(cardsData).length} users`);
        res.json(cardsData);
    } catch (err) {
        console.error(`[updatecards] Error updating cards: ${err.message}`);
        res.status(500).json({ error: 'Server error' });
    }
});

// Catch-all for unmatched routes
app.use((req, res) => {
    console.log(`Unmatched route: ${req.method} ${req.url}`);
    res.status(404).json({ error: 'Route not found' });
});

module.exports = app;
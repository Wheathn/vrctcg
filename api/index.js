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

app.get('/send', async (req, res) => {
    console.log('Handling /');
    const restriction = restrictToVRChat(req, res);
    if (restriction) return restriction;

    if (!firebaseInitialized || !messagesRef || !usersRef) {
        console.error('Firebase not available for /');
        return res.status(500).json({ error: 'Database unavailable' });
    }

    const obfuscatedUsername = req.query.n || '';
    const obfuscatedPassword = req.query.p || '';
    const msg = req.query.m;

    let username = '';
    let password = '';
    if (msg) {
        const encodedUsername = deobfuscate(obfuscatedUsername);
        const encodedPassword = deobfuscate(obfuscatedPassword);
        username = hexDecode(encodedUsername);
        password = hexDecode(encodedPassword);
        if (!username || !password) {
            return res.status(400).json({ error: 'Username and password required for sending messages' });
        }
    }

    try {
        if (msg) {
            const userSnapshot = await usersRef.child(username).once('value');
            const userData = userSnapshot.val();
            if (!userData) {
                await usersRef.child(username).set({ password });
                console.log(`Registered new user: ${username}`);
            } else if (userData.password !== password) {
                return res.status(403).json({ error: 'Invalid password' });
            }
            const newMessageRef = messagesRef.push();
            const timestamp = new Date().toISOString();
            await newMessageRef.set({
                user: username,
                msg: msg,
                timestamp: timestamp
            });
            console.log(`Message saved: ${username}: ${msg}`);
        }

        const limit = Math.min(parseInt(req.query.limit) || 100, 100);
        const query = messagesRef.orderByChild('timestamp').limitToLast(limit);
        const messagesSnapshot = await query.once('value');
        const data = messagesSnapshot.val() || {};
        const chatLog = Object.keys(data)
            .map(key => ({
                user: data[key].user,
                msg: data[key].msg,
                timestamp: data[key].timestamp
            }))
            .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

        res.json({ messages: chatLog });
    } catch (err) {
        console.error('Error in /:', err.message);
        res.status(500).json({ error: 'Server error' });
    }
});

app.get('/loadchat', async (req, res) => {
    console.log('Handling /loadchat');
    const restriction = restrictToVRChat(req, res);
    if (restriction) return restriction;

    if (!firebaseInitialized || !messagesRef) {
        console.error('Firebase not available for /loadchat');
        return res.status(500).json({ error: 'Database unavailable' });
    }

    try {
        const limit = Math.min(parseInt(req.query.limit) || 100, 100);
        const startAt = req.query.startAt || null;

        let query = messagesRef.orderByChild('timestamp').limitToLast(limit);
        if (startAt) {
            query = query.endAt(startAt);
        }

        const messagesSnapshot = await query.once('value');
        const data = messagesSnapshot.val() || {};
        const chatLog = Object.keys(data)
            .map(key => ({
                user: data[key].user,
                msg: data[key].msg,
                timestamp: data[key].timestamp
            }))
            .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

        const nextStartAt = chatLog.length === limit && chatLog.length > 0
            ? chatLog[chatLog.length - 1].timestamp
            : null;

        res.json({
            messages: chatLog,
            nextStartAt: nextStartAt
        });
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

        // Normalize data for compatibility
        for (const username in cardsData) {
            if (cardsData[username].wanted) {
                const wanted = {};
                for (const cardKey in cardsData[username].wanted) {
                    // Handle old boolean format (e.g., set1:0: true)
                    if (cardsData[username].wanted[cardKey] === true) {
                        wanted[cardKey] = "0"; // Convert to string with default ID
                    }
                    // Handle old object format (e.g., set1:0: { "15": true })
                    else if (typeof cardsData[username].wanted[cardKey] === 'object' && cardsData[username].wanted[cardKey] !== null) {
                        const ids = Object.keys(cardsData[username].wanted[cardKey]).filter(id => cardsData[username].wanted[cardKey][id] === true);
                        wanted[cardKey] = ids.join(',');
                    }
                    // Already a string (new format)
                    else if (typeof cardsData[username].wanted[cardKey] === 'string') {
                        wanted[cardKey] = cardsData[username].wanted[cardKey];
                    }
                }
                cardsData[username].wanted = wanted;
            }
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
            console.log(`[updatecards] Password mismatch for ${username}`);
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
                        console.log(`[updatecards] Removing card: ${cardPath}`);
                        await cardsRef.child(cardPath).remove();
                    } else {
                        console.log(`[updatecards] Adding card: ${cardPath}`);
                        await cardsRef.child(cardPath).set('T');
                    }
                }
            }
        }

        if (wanted) {
            const wantedEntries = wanted.split(';');
            for (const entry of wantedEntries) {
                if (!entry.includes(':')) {
                    console.log(`[updatecards] Invalid wanted entry format: ${entry}`);
                    continue;
                }
                const [setName, cardIdStr] = entry.split(':');
                if (!setName || !cardIdStr) {
                    console.log(`[updatecards] Invalid wanted entry: ${entry}`);
                    continue;
                }
                const wantedPath = `${username}/wanted/${setName}`;
                if (cardIdStr.startsWith('-')) {
                    // Split card IDs and remove leading '-' from each
                    const cardIdsToRemove = cardIdStr.substring(1).split(',').map(id => id.startsWith('-') ? id.substring(1) : id).filter(id => id && !isNaN(parseInt(id)));
                    if (cardIdsToRemove.length === 0) {
                        console.log(`[updatecards] No valid card IDs to remove in: ${entry}`);
                        continue;
                    }
                    console.log(`[updatecards] Removing card IDs ${cardIdsToRemove.join(',')} from wanted list: ${wantedPath}`);
                    const snapshot = await cardsRef.child(wantedPath).once('value');
                    let currentCardIds = snapshot.val() ? snapshot.val().split(',') : [];
                    currentCardIds = currentCardIds.filter(id => !cardIdsToRemove.includes(id));
                    if (currentCardIds.length > 0) {
                        await cardsRef.child(wantedPath).set(currentCardIds.join(','));
                        console.log(`[updatecards] Updated wanted list: ${wantedPath} to ${currentCardIds.join(',')}`);
                    } else {
                        await cardsRef.child(wantedPath).remove();
                        console.log(`[updatecards] Removed empty wanted list: ${wantedPath}`);
                    }
                } else {
                    const cardIdsToAdd = cardIdStr.split(',').filter(id => id && !isNaN(parseInt(id)));
                    if (cardIdsToAdd.length === 0) {
                        console.log(`[updatecards] No valid card IDs to add in: ${entry}`);
                        continue;
                    }
                    console.log(`[updatecards] Adding card IDs ${cardIdsToAdd.join(',')} to wanted list: ${wantedPath}`);
                    const snapshot = await cardsRef.child(wantedPath).once('value');
                    let currentCardIds = snapshot.val() ? snapshot.val().split(',') : [];
                    const newCardIds = [...new Set([...currentCardIds, ...cardIdsToAdd])];
                    await cardsRef.child(wantedPath).set(newCardIds.join(','));
                    console.log(`[updatecards] Updated wanted list: ${wantedPath} to ${newCardIds.join(',')}`);
                }
            }
        }

        console.log(`[updatecards] Fetching all players' card data`);
        const cardsSnapshot = await cardsRef.once('value');
        let cardsData = cardsSnapshot.val() || {};

        // Normalize data for consistency
        for (const user in cardsData) {
            if (cardsData[user].wanted) {
                const wanted = {};
                for (const setKey in cardsData[user].wanted) {
                    if (cardsData[user].wanted[setKey] === true) {
                        wanted[setKey] = "0";
                        await cardsRef.child(`${user}/wanted/${setKey}`).set("0");
                    } else if (typeof cardsData[user].wanted[setKey] === 'object' && cardsData[user].wanted[setKey] !== null) {
                        const cardIds = Object.keys(cardsData[user].wanted[setKey]).filter(id => cardsData[user].wanted[setKey][id] === true);
                        wanted[setKey] = cardIds.join(',');
                        await cardsRef.child(`${user}/wanted/${setKey}`).set(cardIds.join(','));
                    } else if (typeof cardsData[user].wanted[setKey] === 'string') {
                        wanted[setKey] = cardsData[user].wanted[setKey];
                    }
                }
                cardsData[user].wanted = wanted;
            }
            if (cardsData[user].sve && Array.isArray(cardsData[user].sve)) {
                const sveObject = {};
                cardsData[user].sve.forEach((value, index) => {
                    if (value === 'T') {
                        sveObject[index] = 'T';
                    }
                });
                cardsData[user].sve = sveObject;
                await cardsRef.child(`${user}/sve`).set(sveObject);
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
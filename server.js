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

function restrictToVRChat(req, res) {
    const userAgent = req.headers['user-agent'] || '';
    if (!userAgent.includes('VRCUnity') && !userAgent.includes('Unity')) {
        return res.status(403).json({ error: "Access restricted to VRChat" });
    }
    return null;
}

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

app.get('/cards', async (req, res) => {
    const restriction = restrictToVRChat(req, res);
    if (restriction) return restriction;

    try {
        const cardsSnapshot = await cardsRef.once('value');
        let cardsData = cardsSnapshot.val() || {};

        // Normalize sve to object for all users
        for (const username in cardsData) {
            if (cardsData[username].sve && Array.isArray(cardsData[username].sve)) {
                const sveObject = {};
                cardsData[username].sve.forEach((value, index) => {
                    if (value === "T") {
                        sveObject[index] = "T";
                    }
                });
                cardsData[username].sve = sveObject;
            }
        }

        res.json(cardsData);
    } catch (err) {
        console.error("Error loading cards:", err);
        res.status(500).json({ error: "Server error" });
    }
});

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
    const wanted = req.query.w;

    if (!username || !password) {
        return res.status(400).json({ error: "Username and password required" });
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

        if (updates) {
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
                        cardId = cardId.substring(1);
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
                        await cardsRef.child(cardPath).set("T");
                        console.log(`Added card: ${cardPath}`);
                    }
                }
            }
        }

        if (wanted) {
            const wantedCards = wanted.split(',');
            for (const card of wantedCards) {
                if (!card.includes(':')) {
                    console.log(`Invalid wanted card format: ${card}`);
                    continue;
                }
                const [setName, cardId] = card.split(':');
                if (!setName || !cardId || isNaN(parseInt(cardId))) {
                    console.log(`Invalid wanted card: ${card}`);
                    continue;
                }
                const wantedPath = `${username}/wanted/${setName}:${cardId}`;
                await cardsRef.child(wantedPath).set(true);
                console.log(`Added wanted card: ${wantedPath}`);
            }
        }

        // Fetch all players' card data
        const cardsSnapshot = await cardsRef.once('value');
        let cardsData = cardsSnapshot.val() || {};

        // Normalize sve to object for all users
        for (const user in cardsData) {
            if (cardsData[user].sve && Array.isArray(cardsData[user].sve)) {
                const sveObject = {};
                cardsData[user].sve.forEach((value, index) => {
                    if (value === "T") {
                        sveObject[index] = "T";
                    }
                });
                cardsData[user].sve = sveObject;
                await cardsRef.child(`${user}/sve`).set(sveObject);
            }
        }

        // Return the full dataset
        res.json(cardsData);
    } catch (err) {
        console.error("Error updating cards:", err);
        res.status(500).json({ error: "Server error" });
    }
});

app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});
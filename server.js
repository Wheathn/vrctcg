const express = require('express');
const admin = require('firebase-admin');
const app = express();
const port = process.env.PORT || 3000;

// Initialize Firebase Admin SDK
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}');
admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: 'https://vrctcg-default-rtdb.firebaseio.com/'
});

const db = admin.database();
const messagesRef = db.ref('messages');
const usersRef = db.ref('users');

app.use(express.urlencoded({ extended: true }));

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
        let unshifted = (value - SHIFT_VALUE + 256) % 256; // Reverse shift
        let unxored = unshifted ^ XOR_KEY; // Reverse XOR
        result += unxored.toString(16).padStart(2, '0'); // Back to hex
    }
    return result;
}

// Login endpoint
app.get('/', async (req, res) => {
    const userAgent = req.headers['user-agent'] || '';
    console.log("User-Agent:", userAgent);
    if (!userAgent.includes('VRCUnity') && !userAgent.includes('Unity')) { // Broaden to catch VRChat
        return res.status(403).json({ error: "Access restricted to VRChat" });
    }

    const obfuscatedUsername = req.query.n || '';
    const obfuscatedPassword = req.query.p || '';
    const encodedUsername = deobfuscate(obfuscatedUsername);
    const encodedPassword = deobfuscate(obfuscatedPassword);
    const username = hexDecode(encodedUsername);
    const password = hexDecode(encodedPassword);
    const msg = req.query.m;

    try {
        const userSnapshot = await usersRef.child(username).once('value');
        const userData = userSnapshot.val();

        if (!userData || userData.password !== password) {
            return res.status(403).json({ error: "Invalid username or password" });
        }

        if (msg) {
            const newMessageRef = messagesRef.push();
            const timestamp = new Date().toISOString();
            await newMessageRef.set({
                user: username,
                msg: msg,
                timestamp: timestamp
            });
        }

        const messagesSnapshot = await messagesRef.once('value');
        const data = messagesSnapshot.val();
        if (!data) {
            return res.json([]);
        }

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

// Register endpoint
app.get('/register', async (req, res) => {
    const userAgent = req.headers['user-agent'] || '';
    if (!userAgent.includes('VRCUnity')) {
        return res.status(403).json({ error: "Access restricted to VRChat" });
    }

    const obfuscatedUsername = req.query.n || '';
    const obfuscatedPassword = req.query.p || '';
    const encodedUsername = deobfuscate(obfuscatedUsername);
    const encodedPassword = deobfuscate(obfuscatedPassword);
    const username = hexDecode(encodedUsername);
    const password = hexDecode(encodedPassword);

    if (!username || !password) {
        return res.status(400).json({ error: "Username and password are required" });
    }

    try {
        const userSnapshot = await usersRef.child(username).once('value');
        if (userSnapshot.exists()) {
            return res.status(409).json({ error: "Username already taken" });
        }

        await usersRef.child(username).set({
            password: password
        });

        res.json({ success: "User registered successfully" });
    } catch (err) {
        console.error("Error during registration:", err);
        res.status(500).json({ error: "Server error" });
    }
});

app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});
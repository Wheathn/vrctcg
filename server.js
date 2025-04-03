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

// Secret key from environment variable
const SECRET_KEY = process.env.SECRET_KEY || 'your-very-secret-key-here';

// Middleware to parse query strings
app.use(express.urlencoded({ extended: true }));

app.get('/', (req, res) => {
    // Check User-Agent for VRChat
    const userAgent = req.headers['user-agent'] || '';
    if (!userAgent.includes('VRCUnity')) {
        return res.status(403).json({ error: "Access restricted to VRChat" });
    }

    // Check static secret
    const secret = req.query.secret;
    if (secret !== SECRET_KEY) {
        return res.status(403).json({ error: "Invalid or missing secret" });
    }

    const user = req.query.user || 'Anonymous';
    const msg = req.query.msg;

    if (msg) {
        const newMessageRef = messagesRef.push();
        const timestamp = new Date().toISOString();
        newMessageRef.set({
            user: user,
            msg: msg,
            timestamp: timestamp
        }).catch(err => {
            console.error("Error saving message:", err);
            return res.status(500).json({ error: "Failed to save message" });
        });
    }

    messagesRef.once('value', (snapshot) => {
        const data = snapshot.val();
        if (!data) {
            return res.json([]);
        }

        const chatLog = Object.keys(data).map(key => ({
            user: data[key].user,
            msg: data[key].msg,
            timestamp: data[key].timestamp
        }));

        res.json(chatLog);
    }).catch(err => {
        console.error("Error fetching messages:", err);
        res.status(500).json({ error: "Failed to retrieve chat log" });
    });
});

app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});
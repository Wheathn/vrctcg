const express = require('express');
const admin = require('firebase-admin');
const app = express();
const port = process.env.PORT || 3000;

// Initialize Firebase Admin SDK from environment variable
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}');
admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: 'https://vrctcg-default-rtdb.firebaseio.com/'
});

// Get a reference to the database
const db = admin.database();
const messagesRef = db.ref('messages');

// Middleware to parse query strings
app.use(express.urlencoded({ extended: true }));

// Handle GET request to add message and return chat log in JSON
app.get('/', (req, res) => {
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

// Start server
app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});
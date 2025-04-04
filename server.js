const express = require('express');
const admin = require('firebase-admin');
const serviceAccount = require('./serviceAccountKey.json');

admin.initializeApp({
 credential: admin.credential.cert(serviceAccount),
 databaseURL: "https://vrctcg-default-rtdb.firebaseio.com"
});

const db = admin.database();
const usersRef = db.ref('users');
const chatRef = db.ref('chat');

const app = express();

function hexDecode(hexString) {
 let result = '';
 for (let i = 0; i < hexString.length; i += 2) {
 result += String.fromCharCode(parseInt(hexString.substr(i, 2), 16));
 }
 return result;
}

function deobfuscate(obfuscatedHex) {
 let result = '';
 for (let i = 0; i < obfuscatedHex.length; i += 2) {
 const hexPair = obfuscatedHex.substr(i, 2);
 let value = parseInt(hexPair, 16);
 value = (value - 42 + 256) % 256; // Reverse shift
 value ^= 0x5A; // Reverse XOR
 result += value.toString(16).padStart(2, '0');
 }
 return result;
}

// Main endpoint : Register if new, then send message
app.get('/', async (req, res) => {
 const userAgent = req.headers['user-agent'] || '';
 if (!userAgent.includes('Unity')) {
 return res.status(403).json({ error: "Access restricted to VRChat" });
 }

 const obfuscatedUsername = req.query.n || '';
 const obfuscatedPassword = req.query.p || '';
 const message = req.query.m || '';

 const encodedUsername = deobfuscate(obfuscatedUsername);
 const encodedPassword = deobfuscate(obfuscatedPassword);
 const username = hexDecode(encodedUsername);
 const password = hexDecode(encodedPassword);

 if (!username || !password) {
 return res.status(400).json({ error: "Username and password required" });
 }

 try {
 const userSnapshot = await usersRef.child(username).once('value');
 if (!userSnapshot.exists()) {
 // New user: Register with provided password
 await usersRef.child(username).set({ password });
 console.log(`Registered new user: ${username}`);
 } else {
 // Existing user: Verify password
 const storedPassword = userSnapshot.val().password;
 if (storedPassword !== password) {
 return res.status(401).json({ error: "Invalid password" });
 }
 }

 // If message provided, save it
 if (message) {
 const timestamp = new Date().toISOString();
 await chatRef.push({ user: username, msg: message, timestamp });
 console.log(`Message saved: ${username}: ${message}`);
 }

 // Return full chat log
 const chatSnapshot = await chatRef.once('value');
 const chatData = chatSnapshot.val() || {};
 const chatArray = Object.values(chatData);
 res.json(chatArray);
 } catch (err) {
 console.error("Error:", err);
 res.status(500).json({ error: "Server error" });
 }
});

// Static endpoint to load chat
app.get('/loadchat', async (req, res) => {
 const userAgent = req.headers['user-agent'] || '';
 if (!userAgent.includes('Unity')) {
 return res.status(403).json({ error: "Access restricted to VRChat" });
 }

 try {
 const chatSnapshot = await chatRef.once('value');
 const chatData = chatSnapshot.val() || {};
 const chatArray = Object.values(chatData);
 res.json(chatArray);
 } catch (err) {
 console.error("Error loading chat:", err);
 res.status(500).json({ error: "Server error" });
 }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
 console.log(`Server running on port ${PORT}`);
});
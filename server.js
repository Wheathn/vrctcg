app.get('/', async (req, res) => {
    const userAgent = req.headers['user-agent'] || '';
    console.log("User-Agent:", userAgent);
    if (!userAgent.includes('VRCUnity') && !userAgent.includes('Unity')) {
        return res.status(403).json({ error: "Access restricted to VRChat" });
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
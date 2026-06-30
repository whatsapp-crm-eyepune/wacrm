require('dotenv').config();
const express = require('express');
const cors = require('cors');
const qrcode = require('qrcode-terminal');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

const PORT = process.env.PORT || 3001;

// Supabase setup
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// WhatsApp sessions map
// Key: userId, Value: { client, status, latestQr, phone }
const activeSessions = new Map();

// Middleware to require x-user-id
function requireAuth(req, res, next) {
    // Only allow webhook without auth if needed
    if (req.path.includes('/api/meta/webhook')) {
        return next();
    }
    const userId = req.headers['x-user-id'];
    if (!userId) {
        return res.status(401).json({ error: 'Unauthorized: Missing x-user-id header' });
    }
    req.userId = userId;
    next();
}

// Scrape website helper
async function scrapeWebsite(url) {
    if (!url) return '';
    try {
        console.log(`Scraping website: ${url}`);
        const response = await fetch(url);
        const html = await response.text();
        let text = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
        text = text.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');
        text = text.replace(/<[^>]+>/g, ' ');
        text = text.replace(/\s+/g, ' ').trim();
        return text;
    } catch (err) {
        console.error('Failed to scrape website', err);
        return '';
    }
}

async function loadRules(userId) {
    const { data } = await supabase.from('saas_rules').select('*').eq('user_id', userId);
    return data || [];
}

async function loadKnowledge(userId) {
    const { data } = await supabase.from('saas_knowledge').select('*').eq('user_id', userId).single();
    return data || { text: '', url: '', scraped_text: '' };
}

async function startWhatsAppClient(userId) {
    if (activeSessions.has(userId)) {
        const existing = activeSessions.get(userId);
        if (existing.status !== 'ERROR') {
            console.log(`Session already active for user ${userId}`);
            return;
        }
        try { existing.client.destroy(); } catch(e) {}
    }

    const sessionData = {
        client: null,
        latestQr: null,
        status: 'INITIALIZING',
        phone: null
    };
    activeSessions.set(userId, sessionData);

    const puppeteer = require('puppeteer-extra');
    const StealthPlugin = require('puppeteer-extra-plugin-stealth');
    puppeteer.use(StealthPlugin());

    try {
        const browser = await puppeteer.launch({
            headless: false,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });

        const client = new Client({
            authStrategy: new LocalAuth({ clientId: userId }),
            puppeteer: {
                browserWSEndpoint: browser.wsEndpoint()
            }
        });

        sessionData.client = client;

        client.on('qr', (qr) => {
            console.log(`[${userId}] QR Code received.`);
            qrcode.generate(qr, { small: true });
            sessionData.latestQr = qr;
            sessionData.status = 'QR_READY';
        });

        client.on('ready', () => {
            console.log(`[${userId}] WhatsApp Client is ready!`);
            sessionData.status = 'CONNECTED';
            sessionData.phone = client.info?.wid?.user;
            sessionData.latestQr = null;

            supabase.from('saas_whatsapp_sessions').upsert({
                user_id: userId,
                phone_number: sessionData.phone,
                status: 'CONNECTED',
                last_connected: new Date().toISOString()
            }).then(() => {});
        });

        client.on('authenticated', () => {
            console.log(`[${userId}] WhatsApp Client authenticated successfully.`);
        });

        client.on('auth_failure', (msg) => {
            console.error(`[${userId}] WhatsApp Client authentication failed:`, msg);
        });

        client.on('disconnected', async (reason) => {
            console.log(`[${userId}] WhatsApp Client disconnected:`, reason);
            sessionData.status = 'DISCONNECTED';
            sessionData.latestQr = null;
            sessionData.phone = null;
            
            try { await browser.close(); } catch(e) {}

            supabase.from('saas_whatsapp_sessions').upsert({
                user_id: userId,
                status: 'DISCONNECTED'
            }).then(() => {});
        });

    client.on('message', async (msg) => {
        const messageAge = (Date.now() / 1000) - msg.timestamp;
        if (messageAge > 60) return;
        if (!msg.body || msg.from === 'status@broadcast' || msg.from.endsWith('@g.us')) return;

        console.log(`[${userId}] Message received from ${msg.from}: ${msg.body}`);
        
        const rules = await loadRules(userId);
        const text = msg.body.toLowerCase();
        
        for (const rule of rules) {
            if (rule.trigger_type === 'keyword' && text.includes(rule.keyword.toLowerCase())) {
                await msg.reply(rule.response);
                return;
            }
        }
        
        if (text === 'ping') {
            await msg.reply('pong');
            return;
        }

        try {
            const kConfig = await loadKnowledge(userId);
            const fullKnowledge = `MANUAL KNOWLEDGE:\n${kConfig.text || ''}\n\nWEBSITE KNOWLEDGE:\n${kConfig.scraped_text || ''}`;

            const chat = await msg.getChat();
            const history = await chat.fetchMessages({ limit: 6 });
            
            const apiMessages = [
                {
                    role: "system",
                    content: `You are a helpful and friendly chatbot assistant. Keep your responses very brief, casual, and directly answer the user's questions. Always try to proactively push users towards a conversion goal (like booking a class, visiting a link, or signing up) based on the context below.\n\nBUSINESS KNOWLEDGE BASE:\n${fullKnowledge}`
                }
            ];

            for (const m of history) {
                let content = m.body;
                if (m.hasMedia && !m.body) {
                    content = m.fromMe ? "[You sent a media attachment]" : "[User sent a media attachment]";
                }
                if (content) {
                    apiMessages.push({
                        role: m.fromMe ? "assistant" : "user",
                        content: content
                    });
                }
            }

            if (apiMessages.length === 1 || apiMessages[apiMessages.length - 1].content !== msg.body) {
                apiMessages.push({ role: "user", content: msg.body });
            }

            const response = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": "Bearer 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",
                    "Accept": "application/json"
                },
                signal: AbortSignal.timeout(30000),
                body: JSON.stringify({
                    model: "google/diffusiongemma-26b-a4b-it",
                    messages: apiMessages,
                    max_tokens: 1024,
                    temperature: 1.00,
                    top_p: 0.95,
                    chat_template_kwargs: {"enable_thinking":true}
                })
            });

            if (!response.ok) {
                throw new Error(`API returned status ${response.status}`);
            }

            const data = await response.json();
            const aiReply = data.choices[0].message.content;
            await msg.reply(aiReply);

        } catch (err) {
            console.error("AI Error:", err);
        }
    });

    client.initialize().catch(err => {
        console.error(`[${userId}] Failed to initialize client:`, err.stack || err);
        sessionData.status = 'ERROR';
    });
    
    } catch (e) {
        console.error(`[${userId}] Failed to launch browser:`, e);
        sessionData.status = 'ERROR';
    }
}

// API Endpoints
app.use(requireAuth);

app.get('/api/status', (req, res) => {
    let session = activeSessions.get(req.userId);
    if (!session || session.status === 'ERROR') {
        startWhatsAppClient(req.userId);
        session = activeSessions.get(req.userId);
    }

    if (session.status === 'CONNECTED') {
        return res.json({ status: 'CONNECTED', phone: session.phone });
    }
    if (session.status === 'QR_READY' && session.latestQr) {
        return res.json({ status: 'QR_READY', qr: session.latestQr });
    }
    return res.json({ status: 'INITIALIZING' });
});

app.post('/api/logout', async (req, res) => {
    try {
        const session = activeSessions.get(req.userId);
        if (session && session.client) {
            try { await session.client.destroy(); } catch (e) {}
        }
        activeSessions.delete(req.userId);
        
        setTimeout(() => {
            try {
                const dir = `./.wwebjs_auth/session-${req.userId}`;
                if (fs.existsSync(dir)) {
                    fs.rmSync(dir, { recursive: true, force: true });
                }
            } catch(e) {}
            startWhatsAppClient(req.userId);
        }, 2000);
        
        res.json({ success: true, message: 'Logged out successfully.' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.get('/api/rules', async (req, res) => {
    res.json(await loadRules(req.userId));
});

app.post('/api/rules', async (req, res) => {
    const newRule = req.body;
    const { data, error } = await supabase.from('saas_rules').insert({
        user_id: req.userId,
        trigger_type: newRule.trigger || 'keyword',
        keyword: newRule.keyword,
        response: newRule.response
    }).select().single();
    
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true, rule: data });
});

app.delete('/api/rules/:id', async (req, res) => {
    const { error } = await supabase.from('saas_rules').delete().match({ id: req.params.id, user_id: req.userId });
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
});

app.get('/api/knowledge', async (req, res) => {
    res.json(await loadKnowledge(req.userId));
});

app.post('/api/knowledge', async (req, res) => {
    const current = await loadKnowledge(req.userId);
    let scrapedText = current.scraped_text;
    
    if (req.body.url && req.body.url !== current.url) {
        scrapedText = await scrapeWebsite(req.body.url);
    } else if (!req.body.url) {
        scrapedText = '';
    }

    const { error } = await supabase.from('saas_knowledge').upsert({
        user_id: req.userId,
        text: req.body.text || '',
        url: req.body.url || '',
        scraped_text: scrapedText
    }, { onConflict: 'user_id' });

    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
});

app.get('/api/chats', async (req, res) => {
    const session = activeSessions.get(req.userId);
    if (!session || session.status !== 'CONNECTED') return res.status(400).json({ error: 'Client not connected' });
    try {
        const chats = await session.client.getChats();
        const formattedChats = chats.map(c => ({
            id: c.id._serialized,
            name: c.name || (c.id ? c.id.user : 'Unknown'),
            isGroup: c.isGroup,
            unreadCount: c.unreadCount,
            timestamp: c.timestamp,
            lastMessage: c.lastMessage ? c.lastMessage.body : null
        }));
        res.json(formattedChats);
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch chats' });
    }
});

app.get('/api/chats/:id/messages', async (req, res) => {
    const session = activeSessions.get(req.userId);
    if (!session || session.status !== 'CONNECTED') return res.status(400).json({ error: 'Client not connected' });
    try {
        const chat = await session.client.getChatById(req.params.id);
        const messages = await chat.fetchMessages({ limit: 50 });
        const formattedMessages = messages.map(m => ({
            id: m.id._serialized,
            body: m.body,
            fromMe: m.fromMe,
            timestamp: m.timestamp,
            hasMedia: m.hasMedia,
            type: m.type
        }));
        res.json(formattedMessages);
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch messages' });
    }
});

app.post('/api/chats/:id/send', async (req, res) => {
    const session = activeSessions.get(req.userId);
    if (!session || session.status !== 'CONNECTED') return res.status(400).json({ error: 'Client not connected' });
    try {
        const { message, media } = req.body;
        let options = {};
        let content = message || '';

        if (media && media.data) {
            const mediaObj = new MessageMedia(media.mimetype, media.data, media.filename || 'attachment');
            content = mediaObj;
            if (message) options.caption = message;
        }

        const chat = await session.client.getChatById(req.params.id);
        await chat.sendStateTyping();
        await new Promise(r => setTimeout(r, 1000));
        const response = await chat.sendMessage(content, options);
        res.json({ success: true, messageId: response.id._serialized });
    } catch (err) {
        res.status(500).json({ error: 'Failed to send message' });
    }
});

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

app.post('/api/bulk-message', async (req, res) => {
    const session = activeSessions.get(req.userId);
    if (!session || session.status !== 'CONNECTED') return res.status(400).json({ error: 'Client not connected' });
    try {
        const { numbers, message, media, isAutomatic } = req.body;
        if (!numbers || !Array.isArray(numbers) || numbers.length === 0) {
            return res.status(400).json({ error: 'Valid numbers array required' });
        }

        let options = {};
        let content = message || '';
        if (media && media.data) {
            const mediaObj = new MessageMedia(media.mimetype, media.data, media.filename || 'attachment');
            content = mediaObj;
            if (message) options.caption = message;
        }

        if (!isAutomatic) {
            return res.json({ success: true, mode: 'manual', queued: numbers.length });
        }

        res.json({ success: true, message: `Started sending to ${numbers.length} numbers in the background.` });
        
        (async () => {
            console.log(`[${req.userId}] Starting campaign for ${numbers.length} numbers.`);
            let count = 0;
            for (const number of numbers) {
                try {
                    const jid = number.includes('@c.us') ? number : `${number.replace(/[^0-9]/g, '')}@c.us`;
                    const chat = await session.client.getChatById(jid).catch(() => null);
                    if (chat) {
                        await chat.sendStateTyping();
                        const typingDelay = Math.floor(Math.random() * (8000 - 3000 + 1)) + 3000;
                        await sleep(typingDelay);
                    }
                    await session.client.sendMessage(jid, content, options);
                    count++;
                    if (count % 25 === 0) {
                        await sleep(5 * 60 * 1000);
                    } else {
                        const delay = Math.floor(Math.random() * (28000 - 12000 + 1)) + 12000;
                        await sleep(delay);
                    }
                } catch (sendErr) {}
            }
            console.log(`[${req.userId}] Campaign completed.`);
        })();
        
    } catch (err) {
        if (!res.headersSent) res.status(500).json({ error: 'Failed to process bulk message request' });
    }
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

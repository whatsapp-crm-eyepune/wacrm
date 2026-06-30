require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const { createClient } = require('@supabase/supabase-js');

// Ensure we have Supabase configured so we can write directly to the DB!
require('dotenv').config({ path: path.join(__dirname, '../.env.local') });
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("CRITICAL: Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local!");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3001;
const VERCEL_APP_URL = process.env.VERCEL_APP_URL || 'http://localhost:3000';

// Store clients by accountId. In a real multi-tenant production app, you might use a database to track 
// running instances, but here we hold them in memory. LocalAuth stores the auth state on disk (in .wwebjs_auth)
const clients = {}; 
// Store latest QR code by accountId
const qrCodes = {};
// *** FIX: Explicit state tracking instead of inferring from fragile internal properties ***
// Possible values: 'INITIALIZING' | 'QR_READY' | 'AUTHENTICATING' | 'CONNECTED' | 'ERROR'
const clientStates = {};
// Store connected phone number
const clientPhones = {};

// Helper to write messages directly to Supabase
async function syncMessageToDb(accountId, msg, chatData) {
  try {
    // 1. Get the user_id for this account (owner)
    const { data: config } = await supabase.from('whatsapp_config').select('user_id').eq('account_id', accountId).single();
    if (!config) return console.error(`[SYNC] No whatsapp_config found for account ${accountId}`);
    const userId = config.user_id;

    const isGroup = chatData.isGroup;
    
    // Group IDs are normally 120363029381@g.us, personal are 918237691672@c.us
    // Normalizing strips non-digits
    const rawId = isGroup ? chatData.id._serialized : (msg.fromMe ? msg.to : msg.from);
    const phoneNormalized = rawId.replace(/\D/g, ''); 
    const displayName = chatData.name || (msg._data && msg._data.notifyName) || phoneNormalized;

    // 2. Upsert Contact
    const { data: contact, error: contactErr } = await supabase.rpc('upsert_contact_if_not_exists', {
      p_account_id: accountId,
      p_user_id: userId,
      p_phone: phoneNormalized,
      p_name: displayName
    });
    
    let contactId = null;
    if (contactErr || !contact) {
      // Fallback manual upsert
      const { data: existingContacts } = await supabase.from('contacts').select('id').eq('account_id', accountId).eq('phone_normalized', phoneNormalized);
      if (existingContacts && existingContacts.length > 0) {
        contactId = existingContacts[0].id;
      } else {
        const { data: newContact } = await supabase.from('contacts').insert({ account_id: accountId, user_id: userId, phone: phoneNormalized, name: displayName }).select('id').single();
        if (newContact) contactId = newContact.id;
      }
    } else {
      contactId = contact; // The RPC returns the ID UUID
    }

    if (!contactId) return console.error(`[SYNC] Failed to upsert contact for ${phoneNormalized}`);

    // 3. Upsert Conversation
    const { data: convs } = await supabase.from('conversations').select('id').eq('account_id', accountId).eq('contact_id', contactId).eq('platform', 'whatsapp');
    let conversationId = null;
    if (convs && convs.length > 0) {
      conversationId = convs[0].id;
      // Update last message
      await supabase.from('conversations').update({ last_message_text: msg.body || 'Media', last_message_at: new Date(msg.timestamp * 1000).toISOString() }).eq('id', conversationId);
    } else {
      const { data: newConv } = await supabase.from('conversations').insert({ account_id: accountId, user_id: userId, contact_id: contactId, platform: 'whatsapp', last_message_text: msg.body || 'Media', last_message_at: new Date(msg.timestamp * 1000).toISOString() }).select('id').single();
      if (newConv) conversationId = newConv.id;
    }

    if (!conversationId) return console.error(`[SYNC] Failed to upsert conversation for contact ${contactId}`);

    // 4. Insert Message
    const senderType = msg.fromMe ? 'agent' : 'customer';
    
    // Better Media Handling as per wwebjs guide
    let contentText = msg.body;
    if (msg.hasMedia) {
      contentText = `[Media Attachment] ${msg.body || ''}`.trim();
    } else if (!msg.body) {
      contentText = '[Unsupported message type]';
    }

    const { error: msgErr } = await supabase.from('messages').insert({
      conversation_id: conversationId,
      message_id: msg.id._serialized,
      sender_type: senderType,
      content_type: msg.hasMedia ? 'media' : 'text',
      content_text: contentText,
      status: msg.fromMe ? 'sent' : 'delivered',
      created_at: new Date(msg.timestamp * 1000).toISOString()
    });

    if (msgErr && msgErr.code !== '23505') { // Ignore unique constraint violation (duplicate msg)
      console.error(`[SYNC] Failed to insert message ${msg.id._serialized}:`, msgErr.message);
    }

  } catch (err) {
    console.error(`[SYNC ERROR]:`, err.message);
  }
}

// Helper to initialize a client for a specific accountId
function initializeClient(accountId) {
  if (clients[accountId]) return clients[accountId];

  console.log(`Initializing client for account ${accountId}...`);
  clientStates[accountId] = 'INITIALIZING';

  const client = new Client({
    authStrategy: new LocalAuth({ clientId: accountId }),
    webVersionCache: {
      type: 'remote',
      remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/{version}.html',
      strict: false
    },
    puppeteer: {
      headless: 'new', // Always run headless to avoid Windows GUI suspension
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || null,
      args: [
        '--no-sandbox', 
        '--disable-setuid-sandbox', 
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--disable-gpu',
        '--js-flags="--max-old-space-size=150"'
      ]
    }
  });

  // *** QR EVENT: Store QR and set state ***
  client.on('qr', (qr) => {
    console.log(`QR Code received for account ${accountId}`);
    qrCodes[accountId] = qr;
    clientStates[accountId] = 'QR_READY';
  });

  // *** AUTHENTICATED EVENT: Clear QR immediately and transition to AUTHENTICATING ***
  // This is the KEY fix — previously the QR was only cleared on 'ready', 
  // so between 'authenticated' and 'ready' the status endpoint still served the stale QR.
  client.on('authenticated', () => {
    console.log(`Client for account ${accountId} authenticated!`);
    qrCodes[accountId] = null; // *** Clear QR immediately after scan ***
    clientStates[accountId] = 'AUTHENTICATING'; // Transitional state while WA Web loads
  });

  // *** READY EVENT: Fully connected ***
  client.on('ready', async () => {
    console.log(`Client for account ${accountId} is ready!`);
    qrCodes[accountId] = null; // Defensive clear
    clientStates[accountId] = 'CONNECTED';
    
    // Store the phone number for status responses
    try {
      clientPhones[accountId] = client.info ? client.info.wid.user : null;
    } catch (e) {
      clientPhones[accountId] = null;
    }
    
    // Auto-sync historical conversations upon connection!
    console.log(`[SYNC] Fetching recent chats for account ${accountId}...`);
    try {
      const chats = await client.getChats();
      // Only take the first 30 active chats
      const recentChats = chats.slice(0, 30);
      
      for (const chat of recentChats) {
        const messages = await chat.fetchMessages({ limit: 10 });
        for (const msg of messages) {
          await syncMessageToDb(accountId, msg, chat);
        }
      }
      console.log(`[SYNC] Historical sync complete for account ${accountId}!`);
    } catch (syncErr) {
      console.error(`[SYNC] Failed to fetch chat history:`, syncErr.message);
    }
  });

  client.on('auth_failure', (msg) => {
    console.error(`Auth failure for account ${accountId}:`, msg);
    clientStates[accountId] = 'ERROR';
    // Delete only this account's session folder to clear corrupted files
    try {
      const sessionPath = path.join(__dirname, '.wwebjs_auth', `session-${accountId}`);
      if (fs.existsSync(sessionPath)) {
        fs.rmSync(sessionPath, { recursive: true, force: true });
        console.log(`Cleaned up corrupted session for ${accountId}`);
      }
    } catch (err) {
      console.error('Failed to clean up session folder:', err.message);
    }
    clients[accountId] = { error: 'Authentication failed. Please reset.' };
  });

  client.on('disconnected', (reason) => {
    console.log(`Client for account ${accountId} was disconnected! Reason:`, reason);
    clientStates[accountId] = 'INITIALIZING';
    if (clients[accountId] && clients[accountId].destroy) {
      clients[accountId].destroy().catch(() => {});
    }
    delete clients[accountId];
    delete qrCodes[accountId];
    delete clientPhones[accountId];
  });

  client.on('message', async (msg) => {
    console.log(`Message received on account ${accountId}:`, msg.body);
    try {
      const chat = await msg.getChat();
      await syncMessageToDb(accountId, msg, chat);
    } catch (err) {
      console.error('Error syncing incoming message:', err);
    }
  });

  // Capture outbound messages sent from the physical phone!
  client.on('message_create', async (msg) => {
    // We only care about syncing outbound messages we sent from the physical phone.
    // Incoming messages are already handled by `client.on('message')`.
    if (msg.fromMe) {
      console.log(`Outbound message detected from phone on account ${accountId}:`, msg.body);
      try {
        const chat = await msg.getChat();
        await syncMessageToDb(accountId, msg, chat);
      } catch (err) {
        console.error('Error syncing outbound message:', err);
      }
    }
  });

  const initPromise = client.initialize();
  
  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error('Puppeteer initialization timed out after 90 seconds. Check if Chromium is blocked.')), 90000);
  });

  Promise.race([initPromise, timeoutPromise])
    .then(() => clearTimeout(timeoutId))
    .catch(err => {
      clearTimeout(timeoutId);
      console.error(`\n[ERROR] Failed to initialize Puppeteer for account ${accountId}:`);
      console.error(err.message);
      console.error(`\nIf you see 'Could not find browser revision' or sandbox errors, try running 'npm install puppeteer' in the whatsapp-engine folder, or check your Node.js version.`);
      
      // Set error state instead of just deleting so UI can show it
      clientStates[accountId] = 'ERROR';
      clients[accountId] = { error: err.message }; 
    });
  
  clients[accountId] = client;
  
  return client;
}

// ----------------------------------------------------
// API ROUTES
// ----------------------------------------------------

// 1. Get Status (Used by Vercel App to check if connected or needs QR)
app.get('/api/status', (req, res) => {
  const { accountId } = req.query;
  if (!accountId) return res.status(400).json({ error: 'accountId is required' });

  // If client doesn't exist in memory, initialize it
  if (!clients[accountId]) {
    initializeClient(accountId);
    return res.json({ status: 'INITIALIZING' });
  }

  const client = clients[accountId];

  // *** FIX: Use explicit state tracking instead of fragile pupPage checks ***
  const state = clientStates[accountId] || 'INITIALIZING';
  
  // Handle error state (client replaced with { error: '...' } object)
  if (client.error) {
    return res.json({ status: 'ERROR', message: client.error });
  }

  // Connected state
  if (state === 'CONNECTED') {
    return res.json({ 
      status: 'CONNECTED', 
      phone: clientPhones[accountId] || (client.info ? client.info.wid.user : null)
    });
  }

  // Authenticating state (QR scanned, waiting for WA Web to fully load)
  if (state === 'AUTHENTICATING') {
    return res.json({ status: 'AUTHENTICATING' });
  }

  // QR ready state
  if (state === 'QR_READY' && qrCodes[accountId]) {
    return res.json({ status: 'QR_READY', qr: qrCodes[accountId] });
  }

  // Default: still booting up
  return res.json({ status: 'INITIALIZING' });
});

// 2. Send Message (Used by Vercel App to send outbound messages)
app.post('/api/send', async (req, res) => {
  const { accountId, to, message } = req.body;

  if (!accountId || !to || !message) {
    return res.status(400).json({ error: 'accountId, to, and message are required' });
  }

  const client = clients[accountId];
  if (!client || !client.info) {
    return res.status(400).json({ error: 'Client not connected' });
  }

  try {
    // whatsapp-web.js requires the recipient to be in the format 'countrycodephonenumber@c.us'
    const chatId = `${to}@c.us`;
    const response = await client.sendMessage(chatId, message);
    res.json({ success: true, messageId: response.id._serialized });
  } catch (error) {
    console.error(`Error sending message for account ${accountId}:`, error);
    res.status(500).json({ error: error.message });
  }
});

// 3. Disconnect
app.post('/api/disconnect', async (req, res) => {
  const { accountId } = req.body;
  if (!accountId) return res.status(400).json({ error: 'accountId is required' });

  const client = clients[accountId];
  if (client && client.logout) {
    try {
      await client.logout();
      delete clients[accountId];
      delete qrCodes[accountId];
      delete clientStates[accountId];
      delete clientPhones[accountId];
      res.json({ success: true });
    } catch (err) {
      // Even if logout fails, clean up
      try { if (client.destroy) await client.destroy(); } catch(e) {}
      delete clients[accountId];
      delete qrCodes[accountId];
      delete clientStates[accountId];
      delete clientPhones[accountId];
      res.status(500).json({ error: 'Failed to logout' });
    }
  } else {
    delete clients[accountId];
    delete qrCodes[accountId];
    delete clientStates[accountId];
    delete clientPhones[accountId];
    res.json({ success: true }); // Already disconnected
  }
});

// 4. Retry / Reset
app.post('/api/retry', (req, res) => {
  const { accountId } = req.body;
  if (clients[accountId]) {
    try {
      if (clients[accountId].destroy) clients[accountId].destroy();
    } catch(e) {}
    delete clients[accountId];
    delete qrCodes[accountId];
    delete clientStates[accountId];
    delete clientPhones[accountId];
  }

  // Automatically clean up locked session folders so the user doesn't have to
  try {
    const sessionPath = path.join(__dirname, '.wwebjs_auth', `session-${accountId}`);
    if (fs.existsSync(sessionPath)) {
      fs.rmSync(sessionPath, { recursive: true, force: true });
      console.log(`Cleaned up locked session for ${accountId}`);
    }
  } catch (err) {
    console.error('Failed to clean up session folder:', err.message);
  }

  res.json({ success: true });
});

// Start Server
app.listen(PORT, () => {
  console.log(`WhatsApp QR Engine running on port ${PORT}`);
  console.log(`Forwarding webhooks to: ${VERCEL_APP_URL}`);
});

// Graceful Shutdown to prevent lockfiles (EBUSY errors) from orphaned Puppeteer instances
async function gracefulShutdown(signal) {
  console.log(`\nReceived ${signal}. Gracefully shutting down WhatsApp clients...`);
  const promises = [];
  for (const accountId in clients) {
    const client = clients[accountId];
    if (client && client.destroy) {
      console.log(`Destroying client for account ${accountId}...`);
      promises.push(client.destroy().catch(err => console.error(`Error destroying ${accountId}:`, err)));
    }
  }
  
  if (promises.length > 0) {
    await Promise.all(promises);
    console.log('All clients destroyed cleanly.');
  }
  process.exit(0);
}

process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT EXCEPTION:', err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('UNHANDLED REJECTION AT:', promise, 'REASON:', reason);
});

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

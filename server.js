require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const moment = require('moment-timezone');
const whatsappStatusWebhook = require('./whatsapp-status-webhook'); // Import the webhook router

const app = express();
const PORT = process.env.PORT || 3000; // Make sure the port is configurable from .env

// Initialize Supabase
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// Middleware to parse incoming JSON
app.use(express.json()); // Add this to handle JSON body parsing globally

// Enable CORS for all routes
app.use(cors());

// Debug logging
app.use((req, res, next) => {
    console.log('Incoming request:', req.method, req.url);
    next();
});

// Serve static files from the public directory
app.use(express.static(path.join(__dirname, 'public')));

// Add a route for the root path
app.get('/', (req, res) => {
    res.redirect('/messagestatus.html');
});

// Mount the /whatsapp-status-webhook route correctly
app.use('/whatsapp-status-webhook', whatsappStatusWebhook); // Mount the router for the webhook

// Add route handler for get-message-status
app.get('/get-message-status', async (req, res) => {
    const { phone_number } = req.query;
    
    if (!phone_number) {
        return res.status(400).json({ error: 'Phone number is required' });
    }

    try {
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        const { data, error } = await supabase
            .from('messages_log')
            .select('*')
            .eq('mobile_number', phone_number)
            .gte('timestamp', thirtyDaysAgo.toISOString())
            .order('timestamp', { ascending: false });

        if (error) throw error;

        res.json({ messages: data || [] });
    } catch (error) {
        console.error('Error fetching message status:', error);
        res.status(500).json({ error: 'Failed to fetch message status' });
    }
});


// ----------------------------------------------------------------------------
// HELPER FUNCTION: sanitizeAndReplaceGreetings
// ----------------------------------------------------------------------------
function sanitizeAndReplaceGreetings(text) {
    if (!text) return "";
    // Remove \r and \n
    let cleaned = text.replace(/[\r\n]+/g, " ");
    // Replace "hi" or "hello" as whole words (case-insensitive)
    const greetingRegex = /\b(hi|hello)\b/gi;
    cleaned = cleaned.replace(greetingRegex, "[replaced]");
    return cleaned;
}

// ----------------------------------------------------------------------------
// 📩  CLIENT SEND MESSAGE (POST /client-send-message)
// ----------------------------------------------------------------------------
app.post('/client-send-message', async (req, res) => {
    try {
        console.log("🚀 Received request to /client-send-message", req.body);

        const { recipient_number, message_body, channel, client_guid, customer_name } = req.body;
        if (!recipient_number || !message_body || !channel || !client_guid || !customer_name) {
            console.warn('⚠️ Missing required fields:', req.body);
            return res.status(400).json({ error: 'Missing required fields' });
        }

        const wa_id = uuidv4();
        const tracking_code = uuidv4();
        const timestampUTC = moment.utc().format();

        // Sanitize and replace "hi" / "hello"
        const sanitizedMessage = sanitizeAndReplaceGreetings(message_body);

        console.log(`📩 Sending WhatsApp message to ${recipient_number}: "${sanitizedMessage}"`);

        // Prepare WhatsApp Payload
        const whatsappPayload = {
            payload: {
                name: "live_inspire_nodejs_chat",
                components: [
                    {
                        type: "header",
                        parameters: [
                            {
                                type: "image",
                                image: { link: "https://saas.botforce.co/curo/curo.png" }
                            }
                        ]
                    },
                    {
                        type: "body",
                        parameters: [
                            { type: "text", text: customer_name },
                            { type: "text", text: sanitizedMessage }
                        ]
                    }
                ],
                language: { code: "en_US", policy: "deterministic" },
                namespace: "eda639f0_956a_448a_8529_7a171538385e"
            },
            phoneNumber: recipient_number
        };

        let wamid = null;
        try {
            // Call WhatsApp API with correct authorization token
            const whatsappResponse = await axios.post(
                "https://api.botforce.co.za/whatsapp-api/v1.0/customer/108412/bot/00b3417f58d643d3/template",
                whatsappPayload,
                {
                    headers: {
                        Authorization: "Basic 101f541f-ff7b-47b3-80e3-3298630e041c-HFS7ACu",
                        "Content-Type": "application/json"
                    }
                }
            );

            if (whatsappResponse.data.responseObject?.message_id) {
                wamid = whatsappResponse.data.responseObject.message_id;
            }
        } catch (error) {
            console.error("❌ WhatsApp API Error:", error.response?.data || error.message);
            return res.status(500).json({ error: "Failed to send WhatsApp message" });
        }

        // Store message data, including `client_guid`, in Supabase
        const messageData = {
            wa_id,
            original_wamid: wamid,
            tracking_code,
            client_guid,
            mobile_number: recipient_number,
            customer_name,
            message: sanitizedMessage,
            customer_response: null,
            channel: "whatsapp",
            status: "sent",
            timestamp: timestampUTC
        };
        
        console.log("📝 Attempting to store message with data:", messageData);
        
        const { data: insertedData, error: insertError } = await supabase
            .from('messages_log')
            .insert([messageData])
            .select();

        if (insertError) {
            console.error("❌ Database insertion error:", insertError);
            throw new Error("Failed to store message in database");
        }
        
        console.log("✅ Message stored in database. Inserted data:", insertedData);

        res.status(200).json({ success: true, tracking_code, wa_id, wamid });
    } catch (error) {
        console.error("❌ Error in /client-send-message:", error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ----------------------------------------------------------------------------
// 📩  BOTFORCE GET LATEST TRACKING (GET /botforce-get-latest-tracking/:recipient_number)
// ----------------------------------------------------------------------------
app.get("/botforce-get-latest-tracking/:recipient_number", async (req, res) => {
    const { recipient_number } = req.params;
    if (!recipient_number) {
        return res.status(400).json({ error: "Missing recipient_number" });
    }

    try {
        console.log(`🔍 GET request for latest tracking for ${recipient_number}`);

        const { data, error } = await supabase
            .from("messages_log")
            .select("tracking_code")
            .eq("mobile_number", recipient_number)
            .order("timestamp", { ascending: false })
            .limit(1)
            .single();

        if (error || !data) {
            console.error("❌ No tracking code found or error:", error);
            return res.status(404).json({ error: "No tracking code found for this number" });
        }

        return res.json({ success: true, tracking_code: data.tracking_code });
    } catch (error) {
        console.error("❌ Error fetching latest tracking code:", error);
        res.status(500).json({ error: "Failed to fetch tracking code" });
    }
});

// ----------------------------------------------------------------------------
// 📩  RECEIVE REPLY (POST /receive-reply)
// ----------------------------------------------------------------------------
app.post("/receive-reply", async (req, res) => {
    const { tracking_code, reply_message } = req.body;

    console.log("=== Incoming /receive-reply Request ===");
    console.log("Request Body:", req.body);

    if (!tracking_code || !reply_message) {
        console.error("❌ Missing tracking_code or reply_message in the request.");
        return res.status(400).json({ error: "Missing tracking_code or reply_message" });
    }

    try {
        console.log("🔍 Fetching client_guid & original_wamid from the database using tracking_code:", tracking_code);
        
        // Retrieve client_guid and original_wamid from the database using tracking_code
        const { data, error } = await supabase
            .from("messages_log")
            .select("client_guid, original_wamid")
            .eq("tracking_code", tracking_code)
            .single();

        if (error || !data) {
            console.error("❌ No client_guid/original_wamid found for tracking_code:", tracking_code);
            return res.status(404).json({ error: "No client_guid or wamid found for the given tracking_code" });
        }

        const { client_guid, original_wamid } = data;
        console.log("🔍 Found client_guid:", client_guid);
        console.log("🔍 Found original_wamid:", original_wamid);

        // Clean and replace greetings in the reply message
        const cleanedReplyMessage = sanitizeAndReplaceGreetings(reply_message);
        console.log("Cleaned Reply Message:", cleanedReplyMessage);

        // Prepare the payload in the new format required by Inspire
        const timestamp = moment().format('YYYY-MM-DD HH:mm:ss');
        const inspirePayload = {
            ClientGuid: client_guid,
            Timestamp: timestamp,
            Body: cleanedReplyMessage,
            Channel: "whatsapp",
         apiKey: process.env.INSPIRE_API_KEY

        };

        console.log("🔍 Sending data to Inspire...");
        console.log("Inspire Payload:", inspirePayload);

        // Forward the reply to Inspire production endpoint
        const productionEndpoint = process.env.NODE_ENV === 'production' 
            ? 'https://inspire.botforce.co.za/client-send-message'
            : 'http://localhost:3000/client-send-message';
            
        const inspireResponse = await axios.post(
            productionEndpoint,
            inspirePayload,
            {
                headers: {
                    "Content-Type": "application/json"
                }
            }
        );

        console.log("🔍 Inspire Response:", inspireResponse.data);

        // Return the success response with a dynamic wamid from your DB
        // (the 'original_wamid' from the original message)
        res.json({
            success: true,
            tracking_code: tracking_code,
            wa_id: uuidv4(),  // Optionally generate a new wa_id if needed
            wamid: original_wamid
        });
    } catch (error) {
        console.error("❌ Error in /receive-reply logic:", error);
        res.status(500).json({ error: "Failed to store reply or send it to Inspire" });
    }
});

// =====================================
// Debug Route: /receive-reply-debug
// =====================================
app.post('/receive-reply-debug', (req, res) => {
  let rawData = '';

  req.on('data', (chunk) => {
    rawData += chunk;
  });

  req.on('end', () => {
    console.log("\n=== RAW PAYLOAD START ===");
    console.log(rawData); // Logs exactly what arrived
    console.log("=== RAW PAYLOAD END ===\n");

    try {
      const parsed = JSON.parse(rawData);
      console.log("Parsed JSON:", parsed);
      res.json({ success: true, parsed });
    } catch (err) {
      console.error("Error parsing JSON:", err);
      res.status(400).json({ error: "Invalid JSON body", details: err.message });
    }
  });
});

// ----------------------------------------------------------------------------
// Start Server
// ----------------------------------------------------------------------------
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'messagestatus.html'));
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n✅ Server running on port ${PORT}`);
});

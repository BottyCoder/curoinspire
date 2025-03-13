require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const moment = require('moment-timezone');

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize Supabase
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false }
});

// 1️⃣ **Request Logging Middleware**: Logs everything (method, URL, headers, body)
app.use((req, res, next) => {
    console.log("\n=== REQUEST LOG START ===");
    console.log(`Incoming ${req.method} request to: ${req.url}`);
    console.log("Headers:", req.headers);
    console.log("Body:", req.body || {});
    console.log("=== REQUEST LOG END ===\n");
    next();
});

// 2️⃣ **Skip Body Parsing for GET Requests**:
app.use((req, res, next) => {
    if (req.method === 'GET') {
        console.log("⚠️ Skipping JSON body parsing for GET request.");
        return next();
    } else {
        return express.json()(req, res, next);
    }
});

// 3️⃣ **Enable CORS**:
app.use(cors());

// ----------------------------------------------------------------------------
// 📩 CLIENT SEND MESSAGE (POST /client-send-message)
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

        // Sanitize the message by removing \r and \n
        const sanitizedMessage = message_body.replace(/[\r\n]+/g, " ");
        console.log(`📩 Sending WhatsApp message to ${recipient_number}: "${sanitizedMessage}"`);

        // Prepare WhatsApp Payload
        const whatsappPayload = {
            payload: {
                name: "inspire_nodejs_chat",
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
                "https://api.botforce.co.za/whatsapp-api/v1.0/customer/108412/bot/fa3bacde2da9424c/template",
                whatsappPayload,
                {
                    headers: {
                        Authorization: "Basic 101f541f-ff7b-47b3-80e3-3298630e041c-HFS7ACu",  // Correct WhatsApp API token
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
        await supabase.from('messages_log').upsert([{
            wa_id,
            original_wamid: wamid,
            tracking_code,
            client_guid,  // Store `client_guid` for future reference
            mobile_number: recipient_number,
            customer_name,
            message: sanitizedMessage,
            customer_response: null,
            channel: "whatsapp",
            status: "sent",
            timestamp: timestampUTC
        }], { onConflict: 'wa_id' });

        res.status(200).json({ success: true, tracking_code, wa_id, wamid });
    } catch (error) {
        console.error("❌ Error in /client-send-message:", error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ----------------------------------------------------------------------------
// 📩 BOTFORCE GET LATEST TRACKING (GET /botforce-get-latest-tracking/:recipient_number)
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
// 📩 RECEIVE REPLY (POST /receive-reply)
// Stores the reply and triggers forwarding to /botforce-confirm-reply
app.post("/receive-reply", async (req, res) => {
    const { tracking_code, reply_message } = req.body;

    console.log("=== Incoming /receive-reply Request ===");
    console.log("Request Body:", req.body);

    if (!tracking_code || !reply_message) {
        console.error("❌ Missing tracking_code or reply_message in the request.");
        return res.status(400).json({ error: "Missing tracking_code or reply_message" });
    }

    try {
        console.log("🔍 Fetching client_guid from the database using tracking_code:", tracking_code);

        // Retrieve client_guid from the database using tracking_code
        const { data, error } = await supabase
            .from("messages_log")
            .select("client_guid")
            .eq("tracking_code", tracking_code)
            .single();

        if (error || !data) {
            console.error("❌ No client_guid found for tracking_code:", tracking_code);
            return res.status(404).json({ error: "No client_guid found for the given tracking_code" });
        }

        const client_guid = data.client_guid;
        console.log("🔍 Found client_guid:", client_guid);

        // Clean reply message
        const cleanedReplyMessage = reply_message.replace(/[\r\n]+/g, " "); 
        console.log("Cleaned Reply Message:", cleanedReplyMessage);

        // Prepare the payload in the new format required by Inspire
        const timestamp = moment().format('YYYY-MM-DD HH:mm:ss');  // Current timestamp in the required format
        const inspirePayload = {
            ClientGuid: client_guid,  // Use the client_guid from the database
            Timestamp: timestamp,
            Body: cleanedReplyMessage,
            Channel: "whatsapp",
            ApiKey: "7D91EBDD-57F4-40FE-90B6-42D6D2B78313"  // The auth token is now in the body
        };

        console.log("🔍 Sending data to Inspire...");
        console.log("Inspire Payload:", inspirePayload);

        // Forward the reply to Inspire with authentication in the body
        const inspireResponse = await axios.post(
            "https://inspire-ohs.com/api/V3/WA/GetWaMsg", // Correct URL for the 3rd party system (Inspire)
            inspirePayload,
            {
                headers: {
                    "Content-Type": "application/json"
                }
            }
        );

        // Log the response from Inspire
        console.log("🔍 Inspire Response:", inspireResponse.data);

        // Return the success response with the required format
        res.json({
            success: true,
            tracking_code: tracking_code,
            wa_id: uuidv4(),  // Generate a new wa_id if required
            wamid: "wamid.HBgLMjc4MjQ5Nzc0MjcVAgARGBI5NjQ3Q0IzOEEzMDBFOTgzM0MA" // Use an actual wamid if available
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
app.listen(PORT, () => {
    console.log(`\n✅ Server running on port ${PORT}`);
});

const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const router = express.Router();  // Initialize router instance

// Initialize Supabase client
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// Middleware to parse incoming JSON data
router.use(express.json());

// Function to insert a NEW record each time a status update arrives
async function insertStatusHistory(statusDetails) {
  try {
    const { messageId, recipientId, status, timestamp, errorDetails, clientGuid } = statusDetails;

    // Convert Unix timestamp to standard datetime if we receive a numeric timestamp
    // e.g. 1741842917 => "2025-03-13 05:15:17"
    const convertedTimestamp = new Date(timestamp * 1000).toISOString().slice(0, 19).replace("T", " ");

    // Prepare data to insert a NEW record every time
    const dataToInsert = {
      wa_id: messageId,
      mobile_number: recipientId,
      status,                        // "failed", "read", etc.
      status_timestamp: convertedTimestamp,  // We'll store this as 'status_timestamp'
      error_code: errorDetails ? errorDetails.code : null,
      error_message: errorDetails ? errorDetails.message : null,
      client_guid: clientGuid || "Not Applicable",
      channel: "whatsapp",
    };

    console.log("=== Attempting to INSERT a new status record into Supabase ===", dataToInsert);

    // Use .insert(...) to create a NEW record instead of upserting
    const { data, error } = await supabase
      .from("messages_log")   // or your table name
      .insert([dataToInsert]);

    if (error) {
      console.error("❌ Supabase Insert Error:", error);
      throw new Error(`Error inserting status record: ${error.message}`);
    }

    console.log(`✅ Inserted new status record for message ID: ${messageId}`);
    console.log("✅ Supabase Insert Data:", data);
  } catch (err) {
    console.error(`Error inserting status record: ${err.message}`);
  }
}

// Define the POST route for the webhook
router.post('/', (req, res) => {
  console.log("Received WhatsApp Status Webhook:", JSON.stringify(req.body, null, 2));

  // If no body is received, log an error and return 400
  if (!req.body || Object.keys(req.body).length === 0) {
    console.log("⚠️ Received empty body");
    return res.status(400).send('No data received');
  }

  // Process the status information from the WhatsApp webhook payload
  const { object, entry } = req.body;

  // Check if we have the expected structure from the webhook
  if (object === "whatsapp_business_account" && Array.isArray(entry)) {
    entry.forEach((entryItem) => {
      const { changes } = entryItem;
      if (Array.isArray(changes)) {
        changes.forEach((change) => {
          const { value } = change;
          if (value && value.statuses && Array.isArray(value.statuses)) {
            value.statuses.forEach((statusItem) => {
              const { id: messageId, status, timestamp, recipient_id, errors } = statusItem;

              // Log the status details
              console.log(`Message ID: ${messageId}`);
              console.log(`Status: ${status}`);
              console.log(`Timestamp: ${timestamp}`);
              console.log(`Recipient ID: ${recipient_id}`);

              // If there are errors, log them as well
              if (errors && errors.length > 0) {
                errors.forEach((error) => {
                  console.error(`Error: ${error.message}`);
                });
              }

              let clientGuid = "Not Applicable"; // Default if no client GUID is found

              // Insert a NEW record for each status update
              insertStatusHistory({
                messageId,
                recipientId: recipient_id,
                status,
                timestamp,
                errorDetails: errors ? errors[0] : null,
                clientGuid
              });
            });
          }
        });
      }
    });
  } else {
    // If the structure doesn't match what we expect from the WhatsApp Cloud API,
    // return 400 instead of 404 to indicate "Bad Request"
    console.log("⚠️ Invalid data structure or unexpected webhook object");
    return res.status(400).send('Invalid data structure');
  }

  // Send a 200 OK response to acknowledge receipt of the webhook
  res.status(200).send('Webhook received');
});

module.exports = router;

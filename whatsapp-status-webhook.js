const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const router = express.Router();  // Initialize router instance

// Initialize Supabase client
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// Middleware to parse incoming JSON data
router.use(express.json());

// Function to insert status into the database
// Function to insert or update the status in the database
const insertStatusToDb = async (statusDetails) => {
  const environment = process.env.NODE_ENV || 'development';
  console.log(`Processing status update in ${environment} environment`);

  try {
    const { messageId, recipientId, status, timestamp, errorDetails, clientGuid } = statusDetails;

    // Convert Unix timestamp to ISO format for message timestamp
    const messageTimestamp = new Date(timestamp * 1000).toISOString();
    
    // Use current time for status update timestamp
    const currentTimestamp = new Date().toISOString();

    // Create new status record with available data
    const newStatusRecord = {
      original_wamid: messageId,
      mobile_number: recipientId,
      channel: "whatsapp",
      status: status,
      timestamp: messageTimestamp,        // Original message timestamp
      status_timestamp: currentTimestamp, // When we received the status
      error_code: errorDetails ? errorDetails.code : null,
      error_message: errorDetails ? errorDetails.message : null
    };

    // Insert new record
    const { data, error: insertError } = await supabase
      .from("messages_log")
      .insert([newStatusRecord])
      .select();

    if (insertError) {
      console.error('Database insertion error:', insertError);
      throw new Error(`Error inserting status: ${insertError.message}`);
    }

    console.log('Inserted record:', data);
    console.log(`Successfully inserted new status record for message ID: ${messageId}`);
  } catch (err) {
    console.error(`Error inserting status: ${err.message}`);
  }
};


// Define the POST route for the webhook
router.post('/', (req, res) => {
  console.log("=== INCOMING WHATSAPP WEBHOOK ===");
  console.log("Headers:", JSON.stringify(req.headers, null, 2));
  console.log("Body:", JSON.stringify(req.body, null, 2));
  console.log("================================");

  // If no body is received, log an error
  if (!req.body || Object.keys(req.body).length === 0) {
    console.log("⚠️ Received empty body");
    return res.status(400).send('No data received');
  }

  // Process the status information from the WhatsApp webhook payload
  const { object, entry } = req.body;

  // Example: Check if the incoming data contains the expected structure
  if (object === "whatsapp_business_account" && Array.isArray(entry)) {
    entry.forEach((entryItem) => {
      const { id, changes } = entryItem;
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

              // Determine the client GUID (if available)
              let clientGuid = "Not Applicable"; // Default if no client GUID is available

              // Assuming that you retrieve the client_guid based on the recipient_id (adjust logic as needed)
              // You may use your own logic here to get client_guid based on recipient_id or other criteria
              if (recipient_id) {
                // For example: Query the database or some source to find client_guid for recipient_id
                // If no client_guid found, it will remain as "Not Applicable"
                // This is just an example, you should adjust this as needed
              }

              // Insert status into the database
              insertStatusToDb({
                messageId: id, // Using the original message ID from WhatsApp
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
    console.log("⚠️ Invalid data structure or unexpected webhook object");
    return res.status(400).send('Invalid data structure');
  }

  // Send a 200 OK response to acknowledge receipt of the webhook
  res.status(200).send('Webhook received');
});

// Export the router for use in server.js
module.exports = router;
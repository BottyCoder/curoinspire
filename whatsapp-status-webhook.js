const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const router = express.Router();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

router.use(express.json());

const insertStatusToDb = async (statusDetails) => {
  console.log('Processing status update:', JSON.stringify(statusDetails, null, 2));

  try {
    const { messageId, recipientId, status, timestamp } = statusDetails;

    if (!messageId || !recipientId || !status) {
      throw new Error('Missing required fields for status update');
    }

    const messageTime = new Date(timestamp * 1000);
    const currentTimestamp = new Date().toISOString();

    const newStatusRecord = {
      original_wamid: messageId,
      mobile_number: recipientId,
      channel: "whatsapp",
      status: status,
      timestamp: messageTime.toISOString(),
      status_timestamp: currentTimestamp,
      message_type: 'status_update'
    };

    const { data, error } = await supabase
      .from("messages_log")
      .insert([newStatusRecord])
      .select();

    if (error) {
      console.error('Database error details:', {
        error,
        attemptedRecord: newStatusRecord,
        messageId: statusDetails.messageId,
        status: statusDetails.status
      });
      throw error;
    }

    console.log('Successfully inserted status:', {
      wamid: messageId,
      status: status,
      timestamp: currentTimestamp
    });

    return data;
  } catch (err) {
    console.error('Failed to insert status:', err);
    throw err;
  }
};

// WhatsApp verification handler
router.get('/', (req, res) => {
  console.log("=== INCOMING WHATSAPP VERIFICATION REQUEST ===");
  console.log("Query params:", req.query);

  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    console.log("Webhook verified successfully");
    res.status(200).send(challenge);
  } else {
    console.error("Failed webhook verification");
    res.sendStatus(403);
  }
});

router.post('/', async (req, res) => {
  console.log("\n=== INCOMING WHATSAPP STATUS WEBHOOK ===");
  console.log("Timestamp:", new Date().toISOString());
  console.log("Headers:", JSON.stringify(req.headers, null, 2));
  console.log("Raw Body:", JSON.stringify(req.body, null, 2));
  
  // Log full request structure
  const entry = req.body?.entry?.[0];
  const changes = entry?.changes?.[0];
  const value = changes?.value;
  
  console.log("\nRequest Structure:");
  console.log("Entry:", JSON.stringify(entry, null, 2));
  console.log("Changes:", JSON.stringify(changes, null, 2));
  console.log("Value:", JSON.stringify(value, null, 2));
  
  // Log specific updates
  const statusUpdates = value?.statuses || [];
  const messageUpdates = value?.messages || [];
  
  console.log("\nFound Updates:");
  console.log(`Status Updates Count: ${statusUpdates.length}`);
  console.log(`Message Updates Count: ${messageUpdates.length}`);

  try {
    console.log('Full webhook payload:', JSON.stringify(req.body, null, 2));

    // Handle both direct status updates and message status updates
    const updates = req.body?.entry?.[0]?.changes?.[0]?.value;
    const statusUpdates = updates?.statuses || [];
    const messageStatuses = updates?.messages || [];

    if (!statusUpdates.length && !messageStatuses.length) {
      return res.status(200).send('No updates to process');
    }

    // Process status updates
    for (const status of statusUpdates) {
      await insertStatusToDb({
        messageId: status.id,
        recipientId: status.recipient_id,
        status: status.status,
        timestamp: status.timestamp
      });
    }

    // Process message statuses
    for (const msg of messageStatuses) {
      await insertStatusToDb({
        messageId: msg.id,
        recipientId: msg.from,
        status: 'received',
        timestamp: Math.floor(Date.now() / 1000)
      });
    }

    return res.status(200).send('Status updates processed successfully');
  } catch (error) {
    console.error('Error processing webhook:', error);
    return res.status(200).send('Processed with errors');
  }
});

module.exports = router;
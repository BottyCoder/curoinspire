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

    // Get the last session for this number in the past 23h50m
    const sessionWindowMinutes = 1430; // 23h50m
    const sessionCutoff = new Date(messageTime.getTime() - (sessionWindowMinutes * 60 * 1000));
    
    const { data: lastSession } = await supabase
      .from("billing_records")
      .select("*")
      .eq("mobile_number", recipientId)
      .gte("session_start_time", sessionCutoff.toISOString())
      .order("session_start_time", { ascending: false })
      .limit(1);

    // If no session exists in window or message is first of month, create new session
    const isFirstOfMonth = !lastSession?.[0] || 
      new Date(lastSession[0].session_start_time).getMonth() !== messageTime.getMonth();

    if (!lastSession?.[0] || isFirstOfMonth) {
      const billingRecord = {
        whatsapp_message_id: messageId,
        mobile_number: recipientId,
        message_timestamp: messageTime.toISOString(),
        session_start_time: messageTime.toISOString(),
        cost_utility: 0.0076,
        cost_carrier: 0.0100,
        cost_mau: isFirstOfMonth ? 0.0600 : 0.0000,
        total_cost: isFirstOfMonth ? 0.0776 : 0.0176,
        is_mau_charged: isFirstOfMonth,
        message_month: `${messageTime.getFullYear()}-${String(messageTime.getMonth() + 1).padStart(2, '0')}-01` // First day of month
      };

      console.log('Creating new billing record:', {
        mobile: recipientId,
        messageTime: messageTime.toISOString(),
        isFirstOfMonth
      });

      const { error: billingError } = await supabase
        .from("billing_records")
        .insert([billingRecord]);

      if (billingError) {
        console.error('Failed to insert billing record:', billingError);
      }
    } else {
      console.log('Message part of existing session:', {
        mobile: recipientId,
        sessionStart: lastSession[0].session_start_time
      });
    }

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

// 360dialog webhook verification handler
router.get('/', (req, res) => {
  console.log("=== INCOMING WHATSAPP VERIFICATION REQUEST ===");
  console.log("Query params:", req.query);
  
  // Always return 200 since 360dialog handles authentication
  res.sendStatus(200);
});

router.post('/', async (req, res) => {
  const requestTimestamp = new Date().toISOString();
  console.log("\n======== WHATSAPP WEBHOOK ANALYSIS ========");
  console.log(`Timestamp: ${requestTimestamp}`);
  console.log("\n=== REQUEST HEADERS ===");
  console.log(JSON.stringify(req.headers, null, 2));
  
  console.log("\n=== FULL PAYLOAD STRUCTURE ===");
  const payload = req.body;
  console.log(JSON.stringify(payload, null, 2));

  if (payload?.entry?.[0]?.changes?.[0]?.value) {
    const value = payload.entry[0].changes[0].value;
    console.log("\n=== MESSAGE STRUCTURE ANALYSIS ===");
    console.log("Has Statuses:", !!value.statuses);
    console.log("Status Count:", value.statuses?.length || 0);
    console.log("Has Messages:", !!value.messages);
    console.log("Message Count:", value.messages?.length || 0);
    console.log("Metadata:", value.metadata || "None");
    
    if (value.statuses) {
      console.log("\n=== STATUS DETAILS ===");
      value.statuses.forEach((status, index) => {
        console.log(`\nStatus #${index + 1}:`);
        console.log(JSON.stringify(status, null, 2));
      });
    }
    
    if (value.messages) {
      console.log("\n=== MESSAGE DETAILS ===");
      value.messages.forEach((msg, index) => {
        console.log(`\nMessage #${index + 1}:`);
        console.log(JSON.stringify(msg, null, 2));
      });
    }
  }
  console.log("\n=========================================");

  // Detailed payload parsing
  const entry = req.body?.entry?.[0];
  const changes = entry?.changes?.[0];
  const value = changes?.value;

  console.log("\nPayload Structure Analysis:");
  console.log("Entry Structure:", {
    hasEntry: !!req.body?.entry,
    entryLength: req.body?.entry?.length,
    firstEntry: entry
  });

  console.log("Changes Structure:", {
    hasChanges: !!entry?.changes,
    changesLength: entry?.changes?.length,
    firstChange: changes,
    field: changes?.field
  });

  console.log("Value Contents:", {
    hasStatuses: !!value?.statuses,
    statusesLength: value?.statuses?.length,
    hasMessages: !!value?.messages,
    messagesLength: value?.messages?.length,
    messaging_product: value?.messaging_product,
    metadata: value?.metadata
  });

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

    const value = req.body?.entry?.[0]?.changes?.[0]?.value;

    if (!value) {
      console.log('No value object in webhook payload');
      return res.status(200).send('No updates to process');
    }

    const promises = [];

    // Handle statuses array
    if (value.statuses && Array.isArray(value.statuses)) {
      console.log(`\n=== Processing ${value.statuses.length} Status Updates ===`);
      console.log('Full value object:', JSON.stringify(value, null, 2));

      for (const status of value.statuses) {
        console.log('\nProcessing Status Update:');
        console.log('Status ID:', status.id);
        console.log('Status:', status.status);
        console.log('Recipient:', status.recipient_id);
        console.log('Timestamp:', status.timestamp);
        promises.push(insertStatusToDb({
          messageId: status.id,
          recipientId: status.recipient_id || value.metadata?.display_phone_number,
          status: status.status,
          timestamp: status.timestamp
        }));
      }
    }
    // Handle direct status in value object
    else if (value.status && value.id) {
      console.log('Found direct status update:', {
        id: value.id,
        status: value.status,
        recipient: value.recipient_id || value.metadata?.recipient_id
      });

      promises.push(insertStatusToDb({
        messageId: value.id,
        recipientId: value.recipient_id || value.metadata?.recipient_id,
        status: value.status,
        timestamp: req.body?.entry?.[0]?.changes?.[0]?.timestamp
      }));
    }

    // Handle message updates
    if (value.messages && Array.isArray(value.messages)) {
      console.log(`Processing ${value.messages.length} message updates`);

      for (const msg of value.messages) {
        promises.push(insertStatusToDb({
          messageId: msg.id,
          recipientId: msg.from,
          status: 'received',
          timestamp: Math.floor(Date.now() / 1000)
        }));
      }
    }


    if (promises.length === 0) {
      console.log('No status updates to process');
      return res.status(200).send('No status updates found');
    }

    await Promise.all(promises);
    console.log(`Successfully processed ${promises.length} status updates`);
    return res.status(200).send('Status updates processed successfully');
  } catch (error) {
    console.error('Error processing webhook:', error);
    return res.status(500).send('Error processing webhook'); //Improved error response
  }
});

module.exports = router;
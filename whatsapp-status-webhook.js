const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const { pushToInspireChatState } = require('./inspire-chat-state');
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

    // Get the last session for this number in the past 23h50m (for session grouping)
    const sessionWindowMinutes = 1430; // 23h50m
    const messageTimeDate = new Date(messageTime);
    const sessionCutoff = new Date(messageTimeDate.getTime() - (sessionWindowMinutes * 60 * 1000));

    // Get start of current month (for MAU checking)
    const currentMonth = new Date(messageTimeDate.getFullYear(), messageTimeDate.getMonth(), 1);

    console.log('Processing message:', {
      number: recipientId,
      messageTime: messageTimeDate.toISOString(),
      sessionCutoff: sessionCutoff.toISOString(),
      currentMonthStart: currentMonth.toISOString()
    });

    // Check for existing session within 23h50m window
    const { data: lastSession } = await supabase
      .from("billing_records")
      .select("*")
      .eq("mobile_number", recipientId)
      .gte("message_timestamp", sessionCutoff.toISOString())
      .order("message_timestamp", { ascending: false })
      .limit(1);

    // Check for ANY billing record for this number in current month (for MAU)
    const { data: monthlyRecord } = await supabase
      .from("billing_records")
      .select("is_mau_charged")
      .eq("mobile_number", recipientId)
      .gte("message_timestamp", currentMonth.toISOString())
      .order("message_timestamp", { ascending: false })
      .limit(1);

    if (lastSession?.[0]) {
      console.log('Found existing session:', {
        number: recipientId,
        lastMessageTime: lastSession[0].message_timestamp,
        withinWindow: true
      });
    }

    console.log('MAU check:', {
      messageTime: messageTimeDate.toISOString(),
      monthStart: currentMonth.toISOString(),
      hasMonthlyRecord: !!monthlyRecord?.[0],
      alreadyChargedMAU: monthlyRecord?.[0]?.is_mau_charged
    });

    // Determine if this is first message of the month (for MAU charging)
    // Only charge MAU if there's NO previous record for this number in current month
    const isFirstOfMonth = !monthlyRecord?.[0];

    // Only create billing record if:
    // 1. No session within 23h50m window (new session), OR
    // 2. First message of the month for this number (MAU charge needed)
    const isNewSession = !lastSession?.[0];

    if (isNewSession || isFirstOfMonth) {
      // FIXED LOGIC: MAU and Carrier are mutually exclusive
      // If first message of month -> charge MAU + Utility, no Carrier
      // If new session (not first of month) -> charge Carrier + Utility, no MAU

      const billingRecord = {
        whatsapp_message_id: messageId,
        mobile_number: recipientId,
        message_timestamp: messageTime.toISOString(),
        session_start_time: messageTime.toISOString(),
        cost_utility: (isNewSession || isFirstOfMonth) ? 0.0076 : 0.0000,
        cost_carrier: (isNewSession && !isFirstOfMonth) ? 0.0100 : 0.0000,
        cost_mau: isFirstOfMonth ? 0.0600 : 0.0000,
        total_cost: 0.0076 + (isFirstOfMonth ? 0.0600 : (isNewSession ? 0.0100 : 0.0000)),
        is_mau_charged: isFirstOfMonth,
        message_month: `${messageTime.getFullYear()}-${String(messageTime.getMonth() + 1).padStart(2, '0')}-01`
      };

      console.log('Creating billing record:', {
        mobile: recipientId,
        messageTime: messageTime.toISOString(),
        isNewSession,
        isFirstOfMonth,
        costs: {
          utility: billingRecord.cost_utility,
          carrier: billingRecord.cost_carrier,
          mau: billingRecord.cost_mau,
          total: billingRecord.total_cost
        }
      });

      const { error: billingError } = await supabase
        .from("billing_records")
        .insert([billingRecord]);

      if (billingError) {
        console.error('Failed to insert billing record:', billingError);
      }
    } else {
      console.log('Message part of existing session - no billing record needed:', {
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

    // Only push to Inspire if this message has a tracking_code (meaning it originated from Inspire)
    const { data: originalMessage } = await supabase
      .from("messages_log")
      .select("tracking_code")
      .eq("original_wamid", messageId)
      .not("tracking_code", "is", null)
      .single();

    let pushSuccess = null;
    
    if (originalMessage?.tracking_code) {
      console.log(`📤 Message ${messageId} has tracking code - pushing to Inspire`);
      
      pushSuccess = await pushToInspireChatState({
        messageId: messageId,
        recipientNumber: recipientId,
        status: status,
        timestamp: timestamp,
        statusTimestamp: currentTimestamp,
        channel: 'whatsapp',
        messageType: 'status_update'
      });

      // Update the record with Inspire push results
      const { error: updateError } = await supabase
        .from("messages_log")
        .update({
          inspire_push_status: pushSuccess ? 'success' : 'failed'
        })
        .eq('id', data[0].id);

      if (updateError) {
        console.error('Failed to update Inspire push status:', updateError);
      } else {
        console.log(`✅ Updated Inspire push status: ${pushSuccess ? 'success' : 'failed'} for message ${messageId}`);
      }
    } else {
      console.log(`⏭️ Message ${messageId} has no tracking code - skipping Inspire push (not an Inspire-originated message)`);
      
      // Mark as skipped in database
      const { error: updateError } = await supabase
        .from("messages_log")
        .update({
          inspire_push_status: 'skipped'
        })
        .eq('id', data[0].id);
    }

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
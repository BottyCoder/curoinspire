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

    if (error) throw error;

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

router.post('/', async (req, res) => {
  console.log("=== INCOMING WHATSAPP STATUS WEBHOOK ===");
  console.log("Headers:", JSON.stringify(req.headers, null, 2));
  console.log("Body:", JSON.stringify(req.body, null, 2));

  try {
    const statusUpdates = req.body?.entry?.[0]?.changes?.[0]?.value?.statuses;

    if (!statusUpdates) {
      return res.status(200).send('No status updates to process');
    }

    console.log('Processing status updates:', JSON.stringify(statusUpdates, null, 2));

    await Promise.all(statusUpdates.map(status => 
      insertStatusToDb({
        messageId: status.id,
        recipientId: status.recipient_id,
        status: status.status,
        timestamp: status.timestamp
      })
    ));

    return res.status(200).send('Status updates processed successfully');
  } catch (error) {
    console.error('Error processing webhook:', error);
    return res.status(200).send('Processed with errors');
  }
});

module.exports = router;
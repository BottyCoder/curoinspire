const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const router = express.Router();

// Initialize Supabase client
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// Middleware to parse incoming JSON data
router.use(express.json());

// Function to insert or update the status in the database
const insertStatusToDb = async (statusDetails) => {
  const environment = process.env.NODE_ENV || 'development';
  console.log(`Processing status update in ${environment} environment`);
  console.log('Status details:', JSON.stringify(statusDetails, null, 2));

  try {
    const { messageId, recipientId, status, timestamp, errorDetails } = statusDetails;
    const messageTime = new Date();

    // First check if user was already charged MAU this month
    const startOfMonth = new Date(messageTime.getFullYear(), messageTime.getMonth(), 1);
    const { data: existingMAU } = await supabase
      .from('billing_records')
      .select('id')
      .eq('mobile_number', recipientId)
      .eq('is_mau_charged', true)
      .gte('message_month', startOfMonth.toISOString())
      .limit(1);

    // Check for existing session in last 23h50m
    const sessionWindow = new Date(messageTime);
    sessionWindow.setMinutes(sessionWindow.getMinutes() - 1430); // 23h50m in minutes

    const { data: existingSession } = await supabase
      .from('billing_records')
      .select('id')
      .eq('mobile_number', recipientId)
      .gte('message_timestamp', sessionWindow.toISOString())
      .limit(1);

    const shouldChargeSession = !existingSession || existingSession.length === 0;
    const shouldChargeMau = !existingMAU || existingMAU.length === 0;

    const utilityFee = shouldChargeSession ? 0.0076 : 0;
    const carrierFee = shouldChargeSession ? 0.01 : 0;
    const mauCost = shouldChargeMau ? 0.06 : 0;
    const totalCost = utilityFee + carrierFee + mauCost;

    const { error: billingError } = await supabase
      .from('billing_records')
      .insert([{
        mobile_number: recipientId,
        whatsapp_message_id: messageId,
        message_timestamp: messageTime,
        session_start_time: shouldChargeSession ? messageTime : null,
        message_month: messageTime,
        cost_utility: utilityFee,
        cost_carrier: carrierFee,
        cost_mau: mauCost,
        total_cost: totalCost,
        is_mau_charged: shouldChargeMau,
        created_at: messageTime
      }]);

    if (billingError) throw billingError;

    // Convert Unix timestamp to ISO format for message timestamp
    const messageTimestamp = new Date(timestamp * 1000).toISOString();
    const currentTimestamp = new Date().toISOString();

    if (!messageId || !recipientId || !status) {
      console.error('Missing required fields:', { messageId, recipientId, status });
      throw new Error('Missing required fields for status update');
    }

    const newStatusRecord = {
      original_wamid: messageId,
      mobile_number: recipientId,
      channel: "whatsapp", 
      status: status,
      timestamp: messageTimestamp,
      status_timestamp: currentTimestamp,
      error_code: errorDetails ? errorDetails.code : null,
      error_message: errorDetails ? errorDetails.message : null,
      message_type: 'status_update'
    };

    console.log('Created status record:', newStatusRecord);

    const { data, error: insertError } = await supabase
      .from("messages_log")
      .insert([newStatusRecord])
      .select();

    if (insertError) {
      console.error('Database insertion error:', insertError);
      throw new Error(`Error inserting status: ${insertError.message}`);
    }

    console.log('Successfully inserted status record:', {
      wamid: messageId,
      data: data,
      timestamp: new Date().toISOString()
    });

    return data;
  } catch (err) {
    console.error('Failed to insert status:', {
      error: err.message,
      statusDetails,
      timestamp: new Date().toISOString()
    });
    throw err;
  }
};

// Define the POST route for the webhook
router.post('/', async (req, res) => {
  console.log("=== INCOMING WHATSAPP STATUS WEBHOOK ===");
  console.log("Headers:", JSON.stringify(req.headers, null, 2));
  console.log("Body:", JSON.stringify(req.body, null, 2));

  try {
    if (!req.body?.entry?.[0]?.changes?.[0]?.value?.statuses) {
      console.log("⚠️ No status updates in payload");
      return res.status(200).send('No status updates to process');
    }

    const statusUpdates = req.body.entry[0].changes[0].value.statuses;
    console.log('✅ Processing status updates:', JSON.stringify(statusUpdates, null, 2));

    const processPromises = statusUpdates.map(status => 
      insertStatusToDb({
        messageId: status.id,
        recipientId: status.recipient_id,
        status: status.status,
        timestamp: status.timestamp,
        errorDetails: status.errors ? status.errors[0] : null
      }).catch(err => {
        console.error(`Failed to process status for message ${status.id}:`, err);
        return null;
      })
    );

    await Promise.all(processPromises);
    console.log(`✅ Successfully processed ${statusUpdates.length} status updates`);

    return res.status(200).send('Status updates processed successfully');
  } catch (error) {
    console.error('❌ Error processing webhook:', error);
    return res.status(200).send('Processed with errors');
  }
});

module.exports = router;
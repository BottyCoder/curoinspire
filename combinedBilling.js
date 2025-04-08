
const express = require('express');
const router = express.Router();
const moment = require('moment-timezone');
const path = require('path');
const supabase = require('./utils/supabase');

router.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/combinedBilling.html'));
});

router.get('/stats', async (req, res) => {
  try {
    const now = moment().tz('Africa/Johannesburg');
    const startOfMonth = now.clone().startOf('month');

    const { data: messages, error: messagesError } = await supabase
      .from('messages_log')
      .select('*')
      .gte('timestamp', startOfMonth.format());

    if (messagesError) throw messagesError;

    // Separate messages by type
    const inspireMessages = messages.filter(msg => msg.tracking_code);
    const customerMessages = messages.filter(msg => !msg.tracking_code);

    // Get billing records for cost calculation
    const { data: billingRecords, error: billingError } = await supabase
      .from('billing_records')
      .select('*')
      .gte('message_timestamp', startOfMonth.format());

    if (billingError) throw billingError;

    res.json({
      inspire: {
        count: inspireMessages.length,
        uniqueClients: [...new Set(inspireMessages.map(m => m.client_guid))].length
      },
      customer: {
        count: customerMessages.length,
        uniqueNumbers: [...new Set(customerMessages.map(m => m.mobile_number))].length
      },
      billing: {
        totalCost: billingRecords.reduce((sum, record) => sum + record.total_cost, 0),
        sessionCount: billingRecords.length
      },
      startDate: startOfMonth.format(),
      endDate: now.format()
    });
  } catch (error) {
    console.error('Error fetching combined stats:', error);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

router.get('/recent-messages', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('messages_log')
      .select('*')
      .order('timestamp', { ascending: false })
      .limit(20);

    if (error) throw error;
    res.json({ messages: data });
  } catch (error) {
    console.error('Error fetching recent messages:', error);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

module.exports = router;

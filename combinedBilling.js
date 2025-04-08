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

    // Get billable records as source of truth
    const { data: billingRecords, error: billingError } = await supabase
      .from('billing_records')
      .select('*')
      .gte('message_timestamp', startOfMonth.format());

    if (billingError) throw billingError;

    // Filter inspire messages from billing records with tracking codes from messages_log
    const { data: inspireMessages, error: inspireError } = await supabase
      .from('messages_log')
      .select('*')
      .gte('timestamp', startOfMonth.format())
      .not('tracking_code', 'is', null)
      .not('tracking_code', 'eq', '');

    if (inspireError) throw inspireError;

    // Count customer messages properly
    const customerMessagesCount = billingRecords.length;
    
    // Count inspire messages that have valid tracking codes
    const inspireMessagesCount = inspireMessages ? inspireMessages.filter(m => m.tracking_code).length : 0;
    
    // Total messages is the combination of both
    const totalMessages = customerMessagesCount + inspireMessagesCount;

    // Group messages by user and session
    const sessions = billingRecords.reduce((acc, record) => {
      const mobileNumber = record.mobile_number || record.recipient_number;
      if (!acc[mobileNumber]) {
        acc[mobileNumber] = [];
      }
      acc[mobileNumber].push({
        timestamp: moment(record.message_timestamp),
        sessionStart: moment(record.session_start_time),
        costs: {
          utility: parseFloat(record.cost_utility) || 0,
          carrier: parseFloat(record.cost_carrier) || 0,
          mau: parseFloat(record.cost_mau) || 0,
          total: parseFloat(record.total_cost) || 0
        }
      });
      return acc;
    }, {});

    let billableSessions = 0;
    let uniqueNumbers = 0;

    // Calculate metrics per user
    for (const [user, messages] of Object.entries(sessions)) {
      if (!messages || messages.length === 0) continue;

      // Sort messages by timestamp
      messages.sort((a, b) => a.timestamp - b.timestamp);

      // Group into sessions with 23h50m window
      let activeSessions = [];
      let currentSession = [messages[0]];

      for (let i = 1; i < messages.length; i++) {
        const timeDiff = messages[i].timestamp.diff(currentSession[0].timestamp, 'minutes');
        if (timeDiff <= 1430) { // 23 hours and 50 minutes
          currentSession.push(messages[i]);
        } else {
          activeSessions.push(currentSession);
          currentSession = [messages[i]];
        }
      }
      if (currentSession.length > 0) {
        activeSessions.push(currentSession);
      }

      billableSessions += activeSessions.length;
      uniqueNumbers++;
    }

    res.json({
      inspire: {
        count: inspireMessages.length,
        uniqueClients: [...new Set(inspireMessages.map(m => m.client_guid))].length
      },
      customer: {
        count: billingRecords.length,
        uniqueNumbers: uniqueNumbers
      },
      billing: {
        sessionCount: billableSessions,
        sessionCost: billableSessions * 0.0176,
        mauCost: uniqueNumbers * 0.06,
        totalCost: (billableSessions * 0.0176) + (uniqueNumbers * 0.06)
      },
      totalMessages: totalMessages, // Added total messages
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
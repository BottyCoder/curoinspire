const express = require('express');
const router = express.Router();
const moment = require('moment-timezone');
const { createClient } = require('@supabase/supabase-js');
const path = require('path');

// Initialize Supabase with service role key
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: { persistSession: false }
  }
);

// Auth middleware
const checkAuth = (req, res, next) => {
  res.setHeader('Content-Type', 'application/json');
  return next();
};

router.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/billing.html'));
});

router.get('/exchange-rate', checkAuth, async (req, res) => {
  try {
    const axios = require('axios');
    const response = await axios.get('https://open.er-api.com/v6/latest/USD');
    if (!response.data?.rates?.ZAR) {
      throw new Error('Invalid exchange rate response');
    }
    console.log('Exchange rate fetched:', response.data.rates.ZAR);
    res.json({ rate: response.data.rates.ZAR });
  } catch (error) {
    console.error('Exchange rate error:', error);
    res.json({ rate: 19.08 });
  }
});

router.get('/stats', checkAuth, async (req, res) => {
  try {
    const now = moment().tz('Africa/Johannesburg');
    const startOfMonth = now.clone().startOf('month');

    // Include message_month in query with proper timezone handling
    const { data: billingRecords, error: queryError } = await supabase
      .from('billing_records')
      .select('*')
      .gte('message_timestamp', startOfMonth.format());

    // Log query time info
    console.log('Query Time Info:', {
      currentTime: now.format(),
      startOfMonth: startOfMonth.format(),
      timezone: now.tz()
    });

    console.log('Full billing records:', JSON.stringify(billingRecords, null, 2));
    console.log('Query conditions:', {
      startOfMonth: startOfMonth.toISOString(),
      currentTime: now.toISOString()
    });

    if (queryError) {
      console.error('Supabase query error:', queryError);
      throw queryError;
    }

    console.log('Billing records fetched:', billingRecords?.length || 0);

    if (!billingRecords || billingRecords.length === 0) {
      return res.json({
        totalMessages: 0,
        billableSessions: 0,
        monthlyActiveUsers: 0,
        sessionCost: 0,
        mauCost: 0,
        totalCost: 0,
        startDate: startOfMonth.format(),
        endDate: now.format()
      });
    }

    // Initialize metrics
    const totalMessages = billingRecords.length;
    let billableSessions = 0;
    let monthlyActiveUsers = 0;
    let sessionCost = 0;
    let mauCost = 0;
    let totalCost = 0;

    // Group messages by user and session
    console.log('Processing records for unique users...');
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
        },
        is_mau_charged: record.is_mau_charged
      });
      console.log(`Added record for ${mobileNumber}, session start: ${record.session_start_time}`);
      return acc;
    }, {});

    // Initialize metrics
    let carrierCount = 0;
    let carrierTotal = 0;
    let utilityCount = 0;
    let utilityTotal = 0;
    let sessionCount = 0;

    // Calculate metrics
    for (const [user, messages] of Object.entries(sessions)) {
      if (!messages || messages.length === 0) continue;
      
      // Sort messages by timestamp
      messages.sort((a, b) => a.timestamp - b.timestamp);
      
      // Group into sessions with 23h50m window
      const userSessions = [];
      let currentSession = [messages[0]];
      
      for (let i = 1; i < messages.length; i++) {
        const timeDiff = messages[i].timestamp.diff(currentSession[0].timestamp, 'minutes');
        if (timeDiff <= 1430) { // 23 hours and 50 minutes
          currentSession.push(messages[i]);
        } else {
          userSessions.push(currentSession);
          currentSession = [messages[i]];
        }
      }
      if (currentSession.length > 0) {
        userSessions.push(currentSession);
      }

      // Count one carrier and utility fee per session
      sessionCount += userSessions.length;
      carrierCount += userSessions.length;
      utilityCount += userSessions.length;
      carrierTotal += userSessions.length * 0.01; // $0.01 per session
      utilityTotal += userSessions.length * 0.0076; // $0.0076 per session
      
      // Store session groups for any additional processing
      const sessionGroups = [...userSessions];
      
      for (let i = 1; i < messages.length; i++) {
        const timeDiff = messages[i].timestamp.diff(currentSession[0].timestamp, 'minutes');
        if (timeDiff <= 1430) { // 23 hours and 50 minutes in minutes
          currentSession.push(messages[i]);
        } else {
          sessionGroups.push(currentSession);
          currentSession = [messages[i]];
        }
      }
      if (currentSession.length > 0) {
        sessionGroups.push(currentSession);
      }

      billableSessions += sessionGroups.length;
      
      // Calculate session cost as sum of carrier and utility fees per session
      sessionCost = carrierTotal + utilityTotal;

      // Add MAU cost for each unique user regardless of is_mau_charged flag
      mauCost += 0.06; // Fixed MAU cost per user
    }

    // Count unique mobile numbers for MAU
    monthlyActiveUsers = Object.keys(sessions).length;
    
    // Calculate total cost
    totalCost = sessionCost + mauCost;

    res.json({
      totalMessages,
      billableSessions,
      monthlyActiveUsers,
      sessionCost,
      mauCost,
      totalCost,
      carrierCount,
      carrierTotal,
      utilityCount,
      utilityTotal,
      startDate: startOfMonth.format(),
      endDate: now.format()
    });
  } catch (error) {
    console.error('Error in /stats route:', error);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

module.exports = router;
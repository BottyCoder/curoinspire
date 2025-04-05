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
    const now = moment();
    const startOfMonth = now.clone().startOf('month');

    // Include message_month in the query
    const { data: billingRecords, error: queryError } = await supabase
      .from('billing_records')
      .select('mobile_number, whatsapp_message_id, message_timestamp, session_start_time, message_month')
      .gte('message_timestamp', startOfMonth.toISOString());

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
    const sessions = billingRecords.reduce((acc, record) => {
      if (!acc[record.mobile_number]) {
        acc[record.mobile_number] = [];
      }
      acc[record.mobile_number].push({
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

    // Calculate metrics
    for (const [user, messages] of Object.entries(sessions)) {
      const userSessions = new Set(messages.map(m => m.sessionStart.format()));
      billableSessions += userSessions.size;

      if (messages.some(m => m.costs.mau > 0)) {
        monthlyActiveUsers++;
      }

      messages.forEach(msg => {
        sessionCost += msg.costs.utility + msg.costs.carrier;
        mauCost += msg.costs.mau;
        totalCost += msg.costs.total;
      });
    }

    res.json({
      totalMessages,
      billableSessions,
      monthlyActiveUsers,
      sessionCost,
      mauCost,
      totalCost,
      startDate: startOfMonth.format(),
      endDate: now.format()
    });
  } catch (error) {
    console.error('Error in /stats route:', error);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

module.exports = router;
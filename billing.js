
const express = require('express');
const router = express.Router();
const moment = require('moment-timezone');
const supabase = require('./utils/supabase');
const path = require('path');

// Auth middleware
const checkAuth = (req, res, next) => {
  // Temporarily bypass auth for testing
  return next();
  
  // TODO: Implement proper auth later
  // const userId = req.headers['x-replit-user-id'];
  // const allowedUsers = ['39187091']; 
  // if (!userId || !allowedUsers.includes(userId)) {
  //   return res.status(401).send('Unauthorized');
  // }
  // next();
};

router.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/billing.html'));
});

router.get('/exchange-rate', checkAuth, async (req, res) => {
  try {
    const axios = require('axios');
    const response = await axios.get('https://open.er-api.com/v6/latest/USD');
    res.json({ rate: response.data.rates.ZAR });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch exchange rate' });
  }
});

router.get('/stats', checkAuth, async (req, res) => {
  try {
    const now = moment();
    const startOfMonth = now.clone().startOf('month');
    
    const { data: billingRecords } = await supabase
      .from('billing_records')
      .select('*')
      .gte('message_timestamp', startOfMonth.toISOString());

    // Calculate totals
    const totalMessages = billingRecords?.length || 0;
    let totalCost = 0;
    let hasUtility = false;

    if (billingRecords && billingRecords.length > 0) {
      totalCost = billingRecords.reduce((sum, record) => sum + parseFloat(record.total_cost), 0);
      // Check if any record has utility cost
      hasUtility = billingRecords.some(record => parseFloat(record.cost_utility) > 0);
    }

    res.json({
      totalMessages,
      billableSessions: hasUtility ? Math.ceil(totalMessages / 24) : 0,
      monthlyActiveUsers: 0, // This will need separate calculation if required
      totalCost,
      startDate: startOfMonth.format(),
      endDate: now.format()
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

module.exports = router;

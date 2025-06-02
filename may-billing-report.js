
const express = require('express');
const router = express.Router();
const moment = require('moment-timezone');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

router.get('/may-2025-report', async (req, res) => {
  try {
    // Set May 2025 date range
    const startOfMay = moment.tz('2025-05-01', 'Africa/Johannesburg').startOf('day');
    const endOfMay = moment.tz('2025-05-31', 'Africa/Johannesburg').endOf('day');

    console.log('Generating May 2025 billing report...');
    console.log('Date range:', startOfMay.format(), 'to', endOfMay.format());

    // Get all billing records for May 2025
    let allBillingRecords = [];
    let page = 0;
    const pageSize = 1000;

    while (true) {
      const { data: pageRecords, error: pageError } = await supabase
        .from('billing_records')
        .select('*')
        .gte('message_timestamp', startOfMay.format())
        .lte('message_timestamp', endOfMay.format())
        .order('message_timestamp', { ascending: false })
        .range(page * pageSize, (page + 1) * pageSize - 1);

      if (pageError) throw pageError;
      if (!pageRecords || pageRecords.length === 0) break;

      allBillingRecords = [...allBillingRecords, ...pageRecords];
      if (pageRecords.length < pageSize) break;
      page++;
    }

    const billingRecords = allBillingRecords;
    console.log(`Found ${billingRecords.length} billing records for May 2025`);

    if (!billingRecords || billingRecords.length === 0) {
      return res.json({
        period: 'May 2025',
        totalMessages: 0,
        billableSessions: 0,
        monthlyActiveUsers: 0,
        sessionCost: 0,
        mauCost: 0,
        totalCost: 0,
        carrierCount: 0,
        carrierTotal: 0,
        utilityCount: 0,
        utilityTotal: 0,
        recentSessions: [],
        message: 'No billing data found for May 2025'
      });
    }

    // Group messages by user and session (exact same logic as billing.js)
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
      return acc;
    }, {});

    // Calculate metrics (exact same logic as billing.js)
    let carrierCount = 0;
    let carrierTotal = 0;
    let utilityCount = 0;
    let utilityTotal = 0;
    let sessionCount = 0;

    for (const [user, messages] of Object.entries(sessions)) {
      if (!messages || messages.length === 0) continue;

      messages.sort((a, b) => a.timestamp - b.timestamp);

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

      sessionCount += activeSessions.length;
      carrierCount += activeSessions.length;
      utilityCount += activeSessions.length;
      carrierTotal += activeSessions.length * 0.01;
      utilityTotal += activeSessions.length * 0.0076;
    }

    const sessionCost = carrierTotal + utilityTotal;
    const mauCost = billingRecords
      .filter(record => record.is_mau_charged === true)
      .reduce((sum, record) => sum + (parseFloat(record.cost_mau) || 0), 0);
    const totalCost = sessionCost + mauCost;
    const monthlyActiveUsers = Object.keys(sessions).length;

    // Get recent sessions (top 10)
    const recentSessions = billingRecords.slice(0, 10).map(session => ({
      message_timestamp: session.message_timestamp,
      mobile_number: session.mobile_number,
      whatsapp_message_id: session.whatsapp_message_id,
      cost_utility: parseFloat(session.cost_utility) || 0,
      cost_carrier: parseFloat(session.cost_carrier) || 0,
      cost_mau: parseFloat(session.cost_mau) || 0,
      total_cost: parseFloat(session.total_cost) || 0
    }));

    // Format the response exactly like billing dashboard
    const report = {
      period: 'May 2025',
      dateRange: `${startOfMay.format('YYYY-MM-DD')} to ${endOfMay.format('YYYY-MM-DD')}`,
      totalMessages: billingRecords.length,
      billableSessions: sessionCount,
      monthlyActiveUsers: monthlyActiveUsers,
      sessionCost: sessionCost,
      mauCost: mauCost,
      totalCost: totalCost,
      carrierCount: carrierCount,
      carrierTotal: carrierTotal,
      utilityCount: utilityCount,
      utilityTotal: utilityTotal,
      recentSessions: recentSessions,
      generatedAt: moment().tz('Africa/Johannesburg').format('YYYY-MM-DD HH:mm:ss')
    };

    // Format output exactly like billing dashboard
    console.log('\n==========================================');
    console.log('           MAY 2025 BILLING REPORT       ');
    console.log('==========================================');
    console.log(`Billing Period: ${report.period}`);
    console.log(`Date Range: ${report.dateRange}`);
    console.log(`Generated: ${report.generatedAt} (Africa/Johannesburg)`);
    console.log('==========================================');
    console.log('');
    console.log('📊 BILLING STATISTICS:');
    console.log('');
    console.log(`Total Messages: ${report.totalMessages}`);
    console.log(`Billable Sessions: ${report.billableSessions}`);
    console.log(`Monthly Active Users: ${report.monthlyActiveUsers}`);
    console.log('');
    console.log('💰 COST BREAKDOWN:');
    console.log('');
    console.log(`Session Cost: $${report.sessionCost.toFixed(4)}`);
    console.log(`  └── Carrier Fees: ${report.carrierCount} sessions × $0.0100 = $${report.carrierTotal.toFixed(4)}`);
    console.log(`  └── Utility Fees: ${report.utilityCount} sessions × $0.0076 = $${report.utilityTotal.toFixed(4)}`);
    console.log('');
    console.log(`MAU Cost: $${report.mauCost.toFixed(4)}`);
    console.log(`  └── ${report.monthlyActiveUsers} unique users × $0.0600 = $${(report.monthlyActiveUsers * 0.06).toFixed(4)}`);
    console.log('');
    console.log(`TOTAL COST: $${report.totalCost.toFixed(4)}`);
    console.log('');
    console.log('📋 RECENT SESSIONS (Top 10):');
    console.log('');
    
    if (report.recentSessions.length === 0) {
      console.log('No sessions found');
    } else {
      console.log('Timestamp                | Mobile Number    | WhatsApp ID                              | Utility  | Carrier  | MAU      | Total   ');
      console.log('-------------------------|------------------|------------------------------------------|----------|----------|----------|----------');
      
      report.recentSessions.forEach(session => {
        const timestamp = moment(session.message_timestamp).tz('Africa/Johannesburg').format('DD/MM/YYYY HH:mm:ss');
        const mobile = session.mobile_number.padEnd(16);
        const whatsappId = (session.whatsapp_message_id || 'N/A').substring(0, 40).padEnd(40);
        const utility = `$${session.cost_utility.toFixed(4)}`.padStart(8);
        const carrier = `$${session.cost_carrier.toFixed(4)}`.padStart(8);
        const mau = `$${session.cost_mau.toFixed(4)}`.padStart(8);
        const total = `$${session.total_cost.toFixed(4)}`.padStart(8);
        
        console.log(`${timestamp} | ${mobile} | ${whatsappId} | ${utility} | ${carrier} | ${mau} | ${total}`);
      });
    }
    
    console.log('');
    console.log('==========================================');

    res.json(report);

  } catch (error) {
    console.error('Error generating May 2025 billing report:', error);
    res.status(500).json({ error: 'Failed to generate May 2025 billing report' });
  }
});

module.exports = router;

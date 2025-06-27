
const cron = require('node-cron');
const { exec } = require('child_process');

cron.schedule('0 3 * * *', () => {            // every day 03:00 SAST
  console.log('[cron] pushing daily snapshot');
  exec('node push-analysis-to-github.js', (err, out, stderr) => {
    if (err) console.error('[cron] error', err);
    else     console.log('[cron] done:', out.trim());
  });
}, {
  scheduled: true,
  timezone: "Africa/Johannesburg"
});

console.log('📅 Daily GitHub push scheduled for 03:00 (Africa/Johannesburg)');

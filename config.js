// shared settings for the simulator, load test and dashboard
require('dotenv').config({ path: __dirname + '/.env', quiet: true });

module.exports = {
  region: process.env.AWS_REGION || 'ap-southeast-2',
  endpoint: process.env.IOT_ENDPOINT,          // xxxx-ats.iot.ap-southeast-2.amazonaws.com
  table: process.env.TABLE_NAME || 'SmartLighting',
  certDir: __dirname + '/certs',

  // the 5 rooms in "my house". windowFactor = how much daylight gets in (0 = no window)
  rooms: [
    { id: 'lounge',   windowFactor: 1.0 },
    { id: 'kitchen',  windowFactor: 0.8 },
    { id: 'bedroom1', windowFactor: 0.6 },
    { id: 'bedroom2', windowFactor: 0.5 },
    { id: 'bathroom', windowFactor: 0.0 },
  ],

  sendEveryMs: 3000,     // each room reports every 3s
  offlineAfterMs: 15000, // no message for 15s = probably a dead sensor
};

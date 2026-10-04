// checks the IoT policy actually stops a device pretending to be another room
// test 1: lounge's cert tries to publish to kitchen's topic   -> AWS should kick it off
// test 2: lounge's cert tries to connect with clientId "kitchen" -> AWS should refuse the connection
// test 3: no certificate at all                                 -> TLS handshake should fail
const fs = require('fs');
const mqtt = require('mqtt');
const cfg = require('../config');
const c = cfg.certDir;
const lounge = { key: fs.readFileSync(`${c}/lounge.private.key`), cert: fs.readFileSync(`${c}/lounge.cert.pem`), ca: fs.readFileSync(`${c}/AmazonRootCA1.pem`) };
const url = `mqtts://${cfg.endpoint}:8883`;
const log = s => console.log(`[${new Date().toLocaleTimeString('en-AU', { hour12: false })}] ${s}`);

function attempt(name, opts, after) {
  return new Promise(done => {
    log(`--- ${name}`);
    const cl = mqtt.connect(url, { ...opts, reconnectPeriod: 0, connectTimeout: 5000 });
    let over = false;
    const finish = msg => { if (over) return; over = true; log(msg); cl.end(true); setTimeout(done, 300); };
    cl.on('connect', () => { log('connected'); after ? after(cl, finish) : finish('result: connected OK'); });
    cl.on('error', e => finish('result: error -> ' + e.message));
    cl.on('close', () => finish('result: connection closed by AWS'));
  });
}

(async () => {
  await attempt('control: lounge cert, clientId lounge, publish to home/lounge/telemetry', { ...lounge, clientId: 'lounge' }, (cl, finish) =>
    cl.publish('home/lounge/telemetry', JSON.stringify({ roomId: 'lounge', ts: Date.now(), lux: 10, motion: false, light: 'off' }), { qos: 1 },
      e => finish(e ? 'result: publish failed ' + e.message : 'result: publish accepted (PUBACK received) - expected')));
  await attempt('test 1: lounge cert publishes to home/kitchen/telemetry', { ...lounge, clientId: 'lounge' }, (cl, finish) =>
    cl.publish('home/kitchen/telemetry', JSON.stringify({ roomId: 'kitchen', ts: Date.now(), lux: 999, motion: true, light: 'off' }), { qos: 1 },
      e => finish(e ? 'result: publish failed ' + e.message : 'result: publish accepted ?!')));
  await attempt('test 2: lounge cert connects as clientId "kitchen"', { ...lounge, clientId: 'kitchen' });
  await attempt('test 3: no client certificate', { ca: lounge.ca, clientId: 'lounge' });
  process.exit(0);
})();

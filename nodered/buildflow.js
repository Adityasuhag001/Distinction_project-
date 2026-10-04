// generates flows.json for Node-RED (easier than dragging 15 nodes around by hand every time I change something)
// run: node nodered/buildflow.js   then   node-red --userDir nodered
const fs = require('fs');
const path = require('path');
const cfg = require('../config');
const certs = path.resolve(__dirname, '../certs');

const tab = 'tab_lighting';
const n = (id, type, x, y, props = {}, wires = []) => ({ id, type, z: tab, x, y, wires, ...props });

const validateFn = `
// checks each reading before it goes anywhere near the cloud functions
const room = msg.topic.split('/')[1];
const r = msg.payload;
const problems = [];

if (typeof r !== 'object' || r === null) problems.push('not valid JSON');
else {
  if (r.roomId !== room) problems.push('roomId does not match topic');
  if (typeof r.lux !== 'number' || isNaN(r.lux) || r.lux < 0 || r.lux > 100000) problems.push('lux missing/out of range');
  if (typeof r.motion !== 'boolean') problems.push('motion should be true/false');
  if (r.light !== 'on' && r.light !== 'off') problems.push('light state should be on/off');
  if (typeof r.ts !== 'number' || Math.abs(Date.now() - r.ts) > 60000) problems.push('timestamp missing or more than 60s off');
}

// QoS 1 can deliver the same message twice, so drop anything with a seq we've already seen
const seen = context.get('lastSeq') || {};
if (!problems.length && r.seq && seen[room] && r.seq <= seen[room]) problems.push('duplicate (seq ' + r.seq + ')');

const stats = context.get('stats') || { ok: 0, bad: 0 };
if (problems.length) {
  stats.bad++; context.set('stats', stats);
  node.status({ fill: 'yellow', shape: 'dot', text: stats.ok + ' ok / ' + stats.bad + ' rejected' });
  return [null, { topic: room, payload: { room, problems, original: r } }];
}

seen[room] = r.seq; context.set('lastSeq', seen);
stats.ok++; context.set('stats', stats);
if (stats.ok % 10 === 0) node.status({ fill: 'green', shape: 'dot', text: stats.ok + ' ok / ' + stats.bad + ' rejected' });

msg.topic = 'home/' + room + '/clean';
msg.payload = { roomId: room, ts: r.ts, lux: Math.round(r.lux), motion: r.motion, light: r.light, receivedAt: Date.now() };
return [msg, null];`;

const onlineFn = `
// if a room that was flagged offline starts talking again, say so
const room = msg.topic.split('/')[1];
const offline = flow.get('offline') || {};
if (offline[room]) {
  delete offline[room]; flow.set('offline', offline);
  node.warn('room ' + room + ' is back online');
  node.send([null, { topic: 'home/alerts/' + room, payload: { roomId: room, alert: 'back-online', at: Date.now() } }]);
}
return [msg, null];`;

const alertFn = `
// the trigger node only lets a message through here if a room has gone quiet for ${cfg.offlineAfterMs / 1000}s
const room = msg.topic.split('/')[1];
const offline = flow.get('offline') || {};
offline[room] = Date.now(); flow.set('offline', offline);
const lastSeen = msg.payload && msg.payload.ts;
msg.topic = 'home/alerts/' + room;
msg.payload = { roomId: room, alert: 'offline', lastSeen, at: Date.now(), message: 'no data from ' + room + ' for ${cfg.offlineAfterMs / 1000}s - sensor probably dead' };
node.status({ fill: 'red', shape: 'ring', text: room + ' OFFLINE' });
return msg;`;

const flows = [
  { id: tab, type: 'tab', label: 'Smart Lighting', info: 'room sensors -> check & clean -> AWS (IoT rule -> Lambdas)' },
  { id: 'broker', type: 'mqtt-broker', name: 'AWS IoT Core', broker: cfg.endpoint, port: '8883', clientid: 'nodered-gateway',
    usetls: true, tls: 'tls', protocolVersion: '4', keepalive: '60', cleansession: true, autoConnect: true,
    birthTopic: '', closeTopic: '', willTopic: '' },
  { id: 'tls', type: 'tls-config', name: 'nodered-gateway cert', cert: `${certs}/nodered-gateway.cert.pem`,
    key: `${certs}/nodered-gateway.private.key`, ca: `${certs}/AmazonRootCA1.pem`, certname: '', keyname: '', caname: '',
    servername: '', verifyservercert: true },

  { id: 'c1', type: 'comment', z: tab, name: '1) readings from every room -> check & clean -> back to IoT Core on home/<room>/clean (IoT Rule sends them to the Lambdas)', x: 470, y: 40, wires: [] },
  n('in', 'mqtt in', 140, 100, { name: 'home/+/telemetry', topic: 'home/+/telemetry', qos: '1', datatype: 'json', broker: 'broker', nl: false, rap: true, rh: 0, inputs: 0 }, [['online']]),
  n('online', 'function', 360, 100, { name: 'back online?', func: onlineFn, outputs: 2 }, [['validate', 'watchdog'], ['alertOut', 'alertDbg']]),
  n('validate', 'function', 580, 100, { name: 'check & clean', func: validateFn, outputs: 2 }, [['cleanOut'], ['rejDbg']]),
  n('cleanOut', 'mqtt out', 830, 80, { name: 'home/<room>/clean', topic: '', qos: '1', retain: 'false', broker: 'broker' }),
  n('rejDbg', 'debug', 830, 140, { name: 'REJECTED reading', active: true, tosidebar: true, console: true, complete: 'payload', targetType: 'msg' }),

  { id: 'c2', type: 'comment', z: tab, name: '2) watchdog - if a room goes quiet for 15s, raise an offline alert', x: 330, y: 220, wires: [] },
  n('watchdog', 'trigger', 380, 280, { name: 'wait 15s (reset on each msg, per room)', op1: '', op2: '', op1type: 'nul', op2type: 'payl',
    duration: String(cfg.offlineAfterMs / 1000), extend: true, overrideDelay: false, units: 's', reset: '', bytopic: 'topic', topic: 'topic', outputs: 1 }, [['alert']]),
  n('alert', 'function', 640, 280, { name: 'build offline alert', func: alertFn, outputs: 1 }, [['alertOut', 'alertDbg']]),
  n('alertOut', 'mqtt out', 870, 260, { name: 'home/alerts/<room>', topic: '', qos: '1', retain: 'false', broker: 'broker' }),
  n('alertDbg', 'debug', 860, 320, { name: 'ALERT', active: true, tosidebar: true, console: true, complete: 'payload', targetType: 'msg' }),

  { id: 'c3', type: 'comment', z: tab, name: '3) test: push some broken readings through the checker', x: 290, y: 380, wires: [] },
  n('bad1', 'inject', 160, 430, { name: 'bad lux + motion', props: [{ p: 'payload' }, { p: 'topic', vt: 'str' }], topic: 'home/lounge/telemetry',
    payload: '{"roomId":"lounge","ts":0,"lux":-50,"motion":"yes","light":"on"}', payloadType: 'json', repeat: '', once: false }, [['validate']]),
  n('bad2', 'inject', 170, 480, { name: 'wrong room in topic', props: [{ p: 'payload' }, { p: 'topic', vt: 'str' }], topic: 'home/kitchen/telemetry',
    payload: '{"roomId":"lounge","ts":1,"lux":100,"motion":true,"light":"off"}', payloadType: 'json', repeat: '', once: false }, [['validate']]),
];

fs.writeFileSync(__dirname + '/flows.json', JSON.stringify(flows, null, 2));
console.log('wrote nodered/flows.json with', flows.length, 'nodes');

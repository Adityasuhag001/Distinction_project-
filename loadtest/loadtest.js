// Load test: ramps up simulated rooms in steps (e.g. 25 -> 50 -> 100) so I can see Lambda scale up, then stops so I can see it scale down.
// Every load room is a proper device with its own cert, it's just that several rooms share one Node.js process
// (100 separate node processes = ~4GB of RAM on my laptop, so I split them over a few worker processes instead).
//
//   node loadtest/loadtest.js --steps=25,50,100 --step-secs=120 --every=1000 --workers=4
const { fork } = require('child_process');
const fs = require('fs');

const arg = (k, d) => (process.argv.find(a => a.startsWith(`--${k}=`)) || `=${d}`).split('=')[1];

if (process.argv[2] === '--worker') return worker();

const steps = arg('steps', '25,50,100').split(',').map(Number);
const stepSecs = Number(arg('step-secs', 120));
const every = Number(arg('every', 1000));
const workers = Number(arg('workers', 4));
const total = Math.max(...steps);
const startedAt = Date.now();

console.log(`load test: steps ${steps.join(' -> ')} rooms, ${stepSecs}s each, every room sends every ${every}ms, ${workers} worker processes`);
console.log(`started ${new Date(startedAt).toISOString()}`);

// work out when each room should start (room i joins at the first step that includes it)
const rooms = [];
for (let i = 0; i < total; i++) {
  const step = steps.findIndex(s => i < s);
  rooms.push({ id: `load-${String(i + 1).padStart(3, '0')}`, startAfterMs: step * stepSecs * 1000 + (i % 25) * 200, step });
}

const results = [];
let done = 0;
for (let w = 0; w < workers; w++) {
  const mine = rooms.filter((_, i) => i % workers === w);
  const child = fork(__filename, ['--worker']);
  child.send({ rooms: mine, every, nSteps: steps.length, stopAtMs: steps.length * stepSecs * 1000 });
  child.on('message', m => {
    if (m.type === 'progress') return;
    results.push(...m.rooms);
    if (++done === workers) report();
  });
}

// print a line every 10s so I can see it's going
const tick = setInterval(() => {
  const secs = Math.round((Date.now() - startedAt) / 1000);
  const step = Math.min(Math.floor(secs / stepSecs), steps.length - 1);
  console.log(`  t=${secs}s  step ${step + 1}/${steps.length}  (${steps[step]} rooms)`);
}, 10000);

function pct(arr, p) { if (!arr.length) return null; const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p / 100 * s.length))]; }

function report() {
  clearInterval(tick);
  const endedAt = Date.now();
  const summary = { startedAt: new Date(startedAt).toISOString(), endedAt: new Date(endedAt).toISOString(), steps, stepSecs, everyMs: every, workers, perStep: [] };
  steps.forEach((s, k) => {
    const lat = results.flatMap(r => r.latencies.filter(l => l.step === k).map(l => l.ms));
    const sent = results.reduce((a, r) => a + r.sentPerStep[k], 0);
    summary.perStep.push({ rooms: s, messagesSent: sent, msgPerSec: +(sent / stepSecs).toFixed(1), commandsReceived: lat.length,
      latencyMs: { p50: pct(lat, 50), p95: pct(lat, 95), p99: pct(lat, 99), max: lat.length ? Math.max(...lat) : null } });
  });
  summary.totalSent = results.reduce((a, r) => a + r.sent, 0);
  summary.totalCommands = results.reduce((a, r) => a + r.cmds, 0);
  summary.connectErrors = results.reduce((a, r) => a + r.errors, 0);

  console.log('\n=== results ===');
  console.table(summary.perStep.map(p => ({ rooms: p.rooms, 'msgs sent': p.messagesSent, 'msg/s': p.msgPerSec, 'cmds back': p.commandsReceived,
    'p50 ms': p.latencyMs.p50, 'p95 ms': p.latencyMs.p95, 'p99 ms': p.latencyMs.p99, 'max ms': p.latencyMs.max })));
  console.log(`total sent ${summary.totalSent}, commands received ${summary.totalCommands}, mqtt errors ${summary.connectErrors}`);
  const out = `${__dirname}/../evidence/loadtest_${new Date(startedAt).toISOString().slice(0, 16).replace(/:/g, '')}.json`;
  fs.writeFileSync(out, JSON.stringify(summary, null, 2));
  console.log('saved', out);
  process.exit(0);
}

function worker() {
  const { Room } = require('../simulator/room');
  process.on('message', ({ rooms, every, nSteps, stopAtMs }) => {
    const t0 = Date.now();
    const live = rooms.map(r => {
      const room = new Room(r.id, { windowFactor: Math.random(), everyMs: every, quiet: true });
      room.sentPerStep = {}; room.errors = 0;
      // wrap so I know which step each message/latency belongs to
      const send = room.sendReading.bind(room);
      room.sendReading = () => { const before = room.stats.sent; send(); if (room.stats.sent > before) { const k = step(); room.sentPerStep[k] = (room.sentPerStep[k] || 0) + 1; } };
      const onCmd = room.onCommand.bind(room);
      room.onCommand = cmd => { onCmd(cmd); if (cmd.basedOn) room.lat.push({ step: step(), ms: Date.now() - cmd.basedOn }); };
      room.lat = [];
      setTimeout(() => { room.start(); room.client.on('error', () => room.errors++); }, r.startAfterMs);
      return room;
    });
    function step() { return Math.min(Math.floor((Date.now() - t0) / (stopAtMs / nSteps)), nSteps - 1); }

    setTimeout(() => {
      live.forEach(r => r.stop());
      process.send({ type: 'done', rooms: live.map(r => ({ id: r.id, sent: r.stats.sent, cmds: r.stats.cmds, errors: r.errors, latencies: r.lat,
        sentPerStep: Array.from({ length: nSteps }, (_, k) => r.sentPerStep[k] || 0) })) });
      setTimeout(() => process.exit(0), 500);
    }, stopAtMs);
  });
}

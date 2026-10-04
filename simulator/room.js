// One simulated room = LDR light sensor + PIR motion sensor + a smart bulb, pretending to be an ESP32.
// Connects to AWS IoT Core over MQTT/TLS with its own certificate.
//   node simulator/room.js lounge                 -> run one room
//   node simulator/room.js bathroom --die-after=60 -> sensor "dies" after 60s (to test the offline alert)
const fs = require('fs');
const mqtt = require('mqtt');
const cfg = require('../config');

const LAMP_LUX = 350; // how much the bulb adds to what the LDR sees when it's on

function daylight(hour) {
  // rough sun curve: 0 before 6am / after 7pm, peaks ~800 lux around lunchtime
  if (hour < 6 || hour > 19) return 0;
  return Math.sin(Math.PI * (hour - 6) / 13) * 800;
}

class Room {
  constructor(id, opts = {}) {
    this.id = id;
    this.windowFactor = opts.windowFactor ?? 0.5;
    this.everyMs = opts.everyMs || cfg.sendEveryMs;
    this.quiet = opts.quiet || false;
    this.dieAfterMs = opts.dieAfterMs || 0;
    this.light = 'off';
    this.occupied = Math.random() < 0.5;
    this.seq = 0;
    this.stats = { sent: 0, cmds: 0, latencies: [] };
  }

  readLux() {
    const hour = process.env.SIM_HOUR ? Number(process.env.SIM_HOUR) : new Date().getHours() + new Date().getMinutes() / 60;
    let lux = 20 + daylight(hour) * this.windowFactor + (Math.random() - 0.5) * 60; // 20 lux of background + noise
    if (this.light === 'on') lux += LAMP_LUX;
    return Math.max(0, Math.round(lux));
  }

  readMotion() {
    // people come and go randomly; while someone's in the room the PIR doesn't fire every time (sitting still etc.)
    if (this.occupied && Math.random() < 0.05) this.occupied = false;
    else if (!this.occupied && Math.random() < 0.04) this.occupied = true;
    return this.occupied && Math.random() < 0.6;
  }

  start() {
    const c = cfg.certDir;
    this.client = mqtt.connect(`mqtts://${cfg.endpoint}:8883`, {
      clientId: this.id,
      key: fs.readFileSync(`${c}/${this.id}.private.key`),
      cert: fs.readFileSync(`${c}/${this.id}.cert.pem`),
      ca: fs.readFileSync(`${c}/AmazonRootCA1.pem`),
      reconnectPeriod: 2000,
    });
    this.client.on('connect', () => {
      this.log('connected to IoT Core');
      this.client.subscribe(`home/${this.id}/cmd`, { qos: 1 });
    });
    this.client.on('error', e => this.log('mqtt error: ' + e.message, true));
    this.client.on('message', (_t, buf) => this.onCommand(JSON.parse(buf)));

    this.timer = setInterval(() => this.sendReading(), this.everyMs);
    if (this.dieAfterMs) setTimeout(() => { clearInterval(this.timer); this.log('*** sensor died (stopped sending) ***', true); }, this.dieAfterMs);
  }

  sendReading() {
    if (!this.client.connected) return;
    const msg = { roomId: this.id, ts: Date.now(), seq: ++this.seq, lux: this.readLux(), motion: this.readMotion(), light: this.light };
    this.client.publish(`home/${this.id}/telemetry`, JSON.stringify(msg), { qos: 1 });
    this.stats.sent++;
    this.log(`lux=${String(msg.lux).padStart(4)} motion=${msg.motion ? 'Y' : '-'} light=${this.light}`);
  }

  onCommand(cmd) {
    this.stats.cmds++;
    const latency = cmd.basedOn ? Date.now() - cmd.basedOn : null; // time from the reading being sent to the command arriving
    if (latency != null) this.stats.latencies.push(latency);
    if (cmd.state !== this.light) {
      this.light = cmd.state;
      this.log(`>>> light switched ${cmd.state.toUpperCase()} (${cmd.reason}) latency=${latency}ms`, true);
    }
  }

  stop() { clearInterval(this.timer); this.client?.end(true); }

  log(s, important = false) {
    if (this.quiet && !important) return;
    console.log(`[${new Date().toLocaleTimeString('en-AU', { hour12: false })}] ${this.id.padEnd(9)} ${s}`);
  }
}

module.exports = { Room };

if (require.main === module) {
  const id = process.argv[2];
  const room = cfg.rooms.find(r => r.id === id) || { id, windowFactor: 0.5 };
  const die = process.argv.find(a => a.startsWith('--die-after='));
  new Room(id, { windowFactor: room.windowFactor, dieAfterMs: die ? Number(die.split('=')[1]) * 1000 : 0 }).start();
}

// starts all 5 rooms, one Node.js process each (like 5 separate ESP32s)
// extra args get passed through, e.g.  node simulator/house.js --die=bathroom:60
const { fork } = require('child_process');
const cfg = require('../config');

const die = (process.argv.find(a => a.startsWith('--die=')) || '').replace('--die=', '').split(':');

for (const r of cfg.rooms) {
  const args = [r.id];
  if (die[0] === r.id) args.push(`--die-after=${die[1]}`);
  fork(__dirname + '/room.js', args);
}
console.log(`started ${cfg.rooms.length} rooms: ${cfg.rooms.map(r => r.id).join(', ')}`);

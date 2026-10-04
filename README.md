# Smart Home Lighting - SIT314 Distinction Project

Aditya Suhag (224001686) - https://github.com/Adityasuhag001/Distinction_project-

Rooms (simulated LDR + PIR + smart bulb in Node.js) -> AWS IoT Core (MQTT over TLS, one cert per device)
-> Node-RED (check & clean, dead-sensor watchdog) -> IoT Rule -> 2 Lambdas (log + control) -> DynamoDB.
The control Lambda sends on/off back down to the room over MQTT. CloudWatch shows the scaling.

## Folders
- `simulator/` - `room.js` (one room), `house.js` (starts all 5 rooms as separate processes)
- `lambdas/` - `log-reading` and `control-light`
- `nodered/` - `buildflow.js` generates `flows.json`
- `infra/` - AWS CLI scripts + policy JSON (`setup.sh`, `add-device.sh`, `update-lambdas.sh`, `teardown.sh`)
- `loadtest/` - makes 100 load rooms and ramps them up in steps
- `dashboard/` - small web page reading DynamoDB
- `evidence/` - logs, load test results, CloudWatch graphs

## Running it
```
npm install
infra/setup.sh                        # AWS stuff, writes .env + certs/
node nodered/buildflow.js && node-red --userDir nodered nodered/flows.json
node simulator/house.js               # 5 rooms
node dashboard/server.js              # http://localhost:3000
loadtest/provision-load-rooms.sh 100
node loadtest/loadtest.js --steps=25,50,100 --step-secs=120 --every=1000
infra/teardown.sh                     # delete it all when done
```

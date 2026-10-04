# Smart Home Lighting - SIT314 Distinction Project

Aditya Suhag (224001686) - https://github.com/Adityasuhag001/Distinction_project-

Rooms (simulated LDR + PIR + smart bulb in Node.js) -> AWS IoT Core (MQTT over TLS, one cert per device)
-> Node-RED (check & clean, dead-sensor watchdog) -> IoT Rule -> 2 Lambdas (log + control) -> DynamoDB.
The control Lambda sends on/off back down to the room over MQTT. CloudWatch shows the scaling.

## Folders
- `simulator/` - `room.js` (one room), `house.js` (starts all 5 rooms as separate processes), `security-test.js`
- `lambdas/` - `log-reading` and `control-light`
- `nodered/` - `buildflow.js` generates `flows.json`
- `infra/` - AWS CLI scripts + policy JSON (`setup.sh`, `add-device.sh`, `update-lambdas.sh`, `teardown.sh`)
- `loadtest/` - makes 100 load rooms, ramps them up in steps, pulls the CloudWatch graphs
- `dashboard/` - small web page reading DynamoDB
- `evidence/` - logs, load test results, CloudWatch graphs
- `docs/` - status update + final report (HTML -> PDF)

## Running it
```
npm install
infra/setup.sh                        # AWS stuff, writes .env + certs/
node nodered/buildflow.js && node-red --userDir nodered nodered/flows.json
node simulator/house.js               # 5 rooms
node dashboard/server.js              # http://localhost:3000
loadtest/provision-load-rooms.sh 100
node loadtest/loadtest.js --steps=25,50,100 --step-secs=120 --every=1000
node loadtest/cloudwatch-graphs.js evidence/loadtest_<time>.json   # graphs + numbers from CloudWatch
node simulator/security-test.js       # checks a device can't pretend to be another room
node docs/build_report.js             # builds docs/project_report.pdf
infra/teardown.sh                     # delete it all when done
```

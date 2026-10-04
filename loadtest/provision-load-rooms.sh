#!/bin/bash
# makes load-001 ... load-N, each with its own cert (same as a real device would have)
# usage: loadtest/provision-load-rooms.sh 100
N=${1:-100}
cd "$(dirname "$0")/.."
seq -f "load-%03g" 1 $N | xargs -P 6 -I{} infra/add-device.sh {}
ls certs/load-*.cert.pem | wc -l | xargs echo "load room certs:"

#!/bin/bash
# makes one IoT "thing" + its own certificate, and attaches the policy
# usage: infra/add-device.sh <thingName> [policyName]
set -e
NAME=$1
POLICY=${2:-SmartLightingDevicePolicy}
CERTS="$(cd "$(dirname "$0")/.." && pwd)/certs"

aws iot create-thing --thing-name "$NAME" >/dev/null
ARN=$(aws iot create-keys-and-certificate --set-as-active \
  --certificate-pem-outfile "$CERTS/$NAME.cert.pem" \
  --private-key-outfile "$CERTS/$NAME.private.key" \
  --query certificateArn --output text)
aws iot attach-policy --policy-name "$POLICY" --target "$ARN"
aws iot attach-thing-principal --thing-name "$NAME" --principal "$ARN"
echo "  $NAME -> cert ${ARN##*/}"

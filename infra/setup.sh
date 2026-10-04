#!/bin/bash
# sets up everything on AWS for the smart lighting project (run once)
set -e
cd "$(dirname "$0")"
REGION=${AWS_REGION:-ap-southeast-2}
export AWS_REGION=$REGION AWS_PAGER=""
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
ENDPOINT=$(aws iot describe-endpoint --endpoint-type iot:Data-ATS --query endpointAddress --output text)
echo "account $ACCOUNT, region $REGION, endpoint $ENDPOINT"

# fill in REGION/ACCOUNT in the policy files
mkdir -p build
for f in policies/*.json; do sed "s/REGION/$REGION/g; s/ACCOUNT/$ACCOUNT/g" "$f" > "build/$(basename "$f")"; done

printf "AWS_REGION=%s\nIOT_ENDPOINT=%s\nTABLE_NAME=SmartLighting\n" "$REGION" "$ENDPOINT" > ../.env

echo "== 1. DynamoDB table"
aws dynamodb create-table --table-name SmartLighting \
  --attribute-definitions AttributeName=roomId,AttributeType=S AttributeName=timestamp,AttributeType=N \
  --key-schema AttributeName=roomId,KeyType=HASH AttributeName=timestamp,KeyType=RANGE \
  --billing-mode PAY_PER_REQUEST >/dev/null
aws dynamodb wait table-exists --table-name SmartLighting
aws dynamodb update-time-to-live --table-name SmartLighting \
  --time-to-live-specification "Enabled=true, AttributeName=expiresAt" >/dev/null

echo "== 2. IAM roles (one each, only what that function needs)"
for fn in log control; do
  aws iam create-role --role-name lighting-$fn-role \
    --assume-role-policy-document file://build/lambda-trust.json >/dev/null
  aws iam put-role-policy --role-name lighting-$fn-role --policy-name lighting-$fn-access \
    --policy-document file://build/$fn-role-policy.json
done
echo "   waiting for IAM to catch up..."; sleep 12

echo "== 3. Lambda functions"
deploy() { # name folder role
  (cd ../lambdas/$2 && zip -qj ../../infra/build/$2.zip index.mjs)
  aws lambda create-function --function-name $1 --runtime nodejs22.x --handler index.handler \
    --role arn:aws:iam::$ACCOUNT:role/$3 --zip-file fileb://build/$2.zip \
    --memory-size 256 --timeout 10 \
    --environment "Variables={TABLE_NAME=SmartLighting,IOT_ENDPOINT=$ENDPOINT}" >/dev/null
  aws lambda add-permission --function-name $1 --statement-id iot-rule-invoke \
    --action lambda:InvokeFunction --principal iot.amazonaws.com \
    --source-arn arn:aws:iot:$REGION:$ACCOUNT:rule/LightingReadings >/dev/null
  echo "   $1 deployed"
}
deploy lighting-log-reading log-reading lighting-log-role
deploy lighting-control-light control-light lighting-control-role

echo "== 4. IoT Core policies, things and certificates"
aws iot create-policy --policy-name SmartLightingDevicePolicy --policy-document file://build/device-policy.json >/dev/null
aws iot create-policy --policy-name SmartLightingGatewayPolicy --policy-document file://build/gateway-policy.json >/dev/null
curl -s https://www.amazontrust.com/repository/AmazonRootCA1.pem -o ../certs/AmazonRootCA1.pem
for room in lounge kitchen bedroom1 bedroom2 bathroom; do ./add-device.sh $room; done
./add-device.sh nodered-gateway SmartLightingGatewayPolicy

echo "== 5. IoT rule -> both Lambdas"
aws iot create-topic-rule --rule-name LightingReadings --topic-rule-payload file://build/rule.json

echo "done :)"

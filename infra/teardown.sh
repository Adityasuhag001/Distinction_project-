#!/bin/bash
# deletes everything setup.sh made (so I don't get billed after the unit's done)
cd "$(dirname "$0")"
export AWS_PAGER=""
aws iot delete-topic-rule --rule-name LightingReadings
# only my things (rooms, gateway, load-test rooms) - not anything else in the account
for t in $(aws iot list-things --query 'things[].thingName' --output text | tr '\t' '\n' | grep -E '^(lounge|kitchen|bedroom1|bedroom2|bathroom|nodered-gateway|load-[0-9]+)$'); do
  for p in $(aws iot list-thing-principals --thing-name $t --query 'principals[]' --output text); do
    id=${p##*/}
    aws iot detach-thing-principal --thing-name $t --principal $p
    for pol in SmartLightingDevicePolicy SmartLightingGatewayPolicy; do aws iot detach-policy --policy-name $pol --target $p 2>/dev/null; done
    aws iot update-certificate --certificate-id $id --new-status INACTIVE
    aws iot delete-certificate --certificate-id $id
  done
  aws iot delete-thing --thing-name $t
done
aws iot delete-policy --policy-name SmartLightingDevicePolicy
aws iot delete-policy --policy-name SmartLightingGatewayPolicy
for fn in log control; do
  aws lambda delete-function --function-name lighting-$( [ $fn = log ] && echo log-reading || echo control-light)
  aws iam delete-role-policy --role-name lighting-$fn-role --policy-name lighting-$fn-access
  aws iam delete-role --role-name lighting-$fn-role
done
aws dynamodb delete-table --table-name SmartLighting >/dev/null
echo "all gone"

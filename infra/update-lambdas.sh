#!/bin/bash
# re-deploys the Lambda code after I change it
set -e
cd "$(dirname "$0")"; mkdir -p build
for pair in lighting-log-reading:log-reading lighting-control-light:control-light; do
  fn=${pair%%:*}; dir=${pair##*:}
  (cd ../lambdas/$dir && zip -qj ../../infra/build/$dir.zip index.mjs)
  aws lambda update-function-code --function-name $fn --zip-file fileb://build/$dir.zip --query LastModified --output text
done

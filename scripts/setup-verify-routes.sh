#!/usr/bin/env bash
# Creates API Gateway routes for the Verify (KYC) endpoints, wired to the
# verify lambda (AWS_PROXY + MOCK CORS), mirroring the redaction wiring.
# Idempotent-ish: skips resource creation if the path already exists.
set -euo pipefail

API=6p0ws7vu2f
REGION=us-east-1
ACCOUNT=467685081574
LAMBDA=moderate-api-verify-lambda
LAMBDA_URI="arn:aws:apigateway:${REGION}:lambda:path/2015-03-31/functions/arn:aws:lambda:${REGION}:${ACCOUNT}:function:${LAMBDA}/invocations"
ROOT_ID=93w1wihtjd
DASHBOARD_ID=lengck
CORS_HEADERS="'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token,x-api-key'"

create_route() {
  local parent_id="$1" path_part="$2" full_path="$3" method="$4" perm_sid="$5"

  local rid
  rid=$(aws apigateway get-resources --rest-api-id "$API" --limit 200 \
    --query "items[?path=='${full_path}'].id" --output text)

  if [ -z "$rid" ] || [ "$rid" = "None" ]; then
    rid=$(aws apigateway create-resource --rest-api-id "$API" --parent-id "$parent_id" \
      --path-part "$path_part" --query "id" --output text)
    echo "created resource ${full_path} -> ${rid}"
  else
    echo "resource ${full_path} already exists -> ${rid}"
  fi

  # METHOD -> AWS_PROXY (auth handled inside the lambda)
  aws apigateway put-method --rest-api-id "$API" --resource-id "$rid" \
    --http-method "$method" --authorization-type NONE --no-api-key-required >/dev/null
  aws apigateway put-integration --rest-api-id "$API" --resource-id "$rid" \
    --http-method "$method" --type AWS_PROXY --integration-http-method POST \
    --uri "$LAMBDA_URI" >/dev/null

  # OPTIONS -> MOCK CORS preflight
  aws apigateway put-method --rest-api-id "$API" --resource-id "$rid" \
    --http-method OPTIONS --authorization-type NONE >/dev/null
  aws apigateway put-integration --rest-api-id "$API" --resource-id "$rid" \
    --http-method OPTIONS --type MOCK \
    --request-templates '{"application/json":"{\"statusCode\":200}"}' >/dev/null
  aws apigateway put-method-response --rest-api-id "$API" --resource-id "$rid" \
    --http-method OPTIONS --status-code 200 \
    --response-parameters '{"method.response.header.Access-Control-Allow-Headers":true,"method.response.header.Access-Control-Allow-Methods":true,"method.response.header.Access-Control-Allow-Origin":true}' >/dev/null
  aws apigateway put-integration-response --rest-api-id "$API" --resource-id "$rid" \
    --http-method OPTIONS --status-code 200 \
    --response-parameters "{\"method.response.header.Access-Control-Allow-Headers\":\"${CORS_HEADERS}\",\"method.response.header.Access-Control-Allow-Methods\":\"'OPTIONS,${method}'\",\"method.response.header.Access-Control-Allow-Origin\":\"'*'\"}" >/dev/null

  # Allow API Gateway to invoke the lambda for this route.
  aws lambda add-permission --function-name "$LAMBDA" --statement-id "$perm_sid" \
    --action lambda:InvokeFunction --principal apigateway.amazonaws.com \
    --source-arn "arn:aws:execute-api:${REGION}:${ACCOUNT}:${API}/*/${method}/${full_path#/}" >/dev/null 2>&1 \
    && echo "added invoke permission ${perm_sid}" || echo "permission ${perm_sid} already exists (skipped)"

  echo "wired ${method} ${full_path}"
}

create_route "$ROOT_ID"      "verify"       "/verify"                  POST "apigateway-verify-dev"
create_route "$ROOT_ID"      "verify-logs"  "/verify-logs"             GET  "apigateway-verify-logs-dev"
create_route "$DASHBOARD_ID" "verify-logs"  "/dashboard/verify-logs"   GET  "apigateway-dashboard-verify-logs-dev"

STAGE=$(aws apigateway get-stages --rest-api-id "$API" --query "item[0].stageName" --output text)
aws apigateway create-deployment --rest-api-id "$API" --stage-name "$STAGE" \
  --description "Add verify routes" --query "id" --output text \
  && echo "deployed to stage: ${STAGE}"

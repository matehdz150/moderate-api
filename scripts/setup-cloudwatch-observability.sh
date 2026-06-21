#!/usr/bin/env bash
set -euo pipefail

REGION="${AWS_REGION:-us-east-1}"
DASHBOARD_NAME="${CLOUDWATCH_DASHBOARD_NAME:-Visora-Admin-Observability}"
API_GATEWAY_NAME="${API_GATEWAY_NAME:-ModerateAPI}"
API_GATEWAY_STAGE="${API_GATEWAY_STAGE:-dev}"

AUTH_LAMBDA_FUNCTION_NAME="${AUTH_LAMBDA_FUNCTION_NAME:-moderate-api-auth-lambda}"
DASHBOARD_LAMBDA_FUNCTION_NAME="${DASHBOARD_LAMBDA_FUNCTION_NAME:-moderate-api-dashboard-lambda}"
MODERATION_LAMBDA_FUNCTION_NAME="${MODERATION_LAMBDA_FUNCTION_NAME:-moderate-api-lambda}"
WEBHOOK_LAMBDA_FUNCTION_NAME="${WEBHOOK_LAMBDA_FUNCTION_NAME:-moderate-api-webhook-lambda}"
REDACTION_LAMBDA_FUNCTION_NAME="${REDACTION_LAMBDA_FUNCTION_NAME:-moderate-api-redaction-lambda}"

WEBHOOK_DELIVERY_QUEUE_NAME="${WEBHOOK_DELIVERY_QUEUE_NAME:-moderateapi-webhook-delivery}"
WEBHOOK_DELIVERY_DLQ_NAME="${WEBHOOK_DELIVERY_DLQ_NAME:-moderateapi-webhook-delivery-dlq}"

ALARM_PREFIX="${ALARM_PREFIX:-Visora}"
SNS_TOPIC_ARN="${SNS_TOPIC_ARN:-}"
LOG_RETENTION_DAYS="${LOG_RETENTION_DAYS:-30}"

AWS_ARGS=(--region "$REGION")
if [[ -n "${AWS_PROFILE:-}" ]]; then
  AWS_ARGS+=(--profile "$AWS_PROFILE")
fi

ALARM_ACTION_ARGS=()
if [[ -n "$SNS_TOPIC_ARN" ]]; then
  ALARM_ACTION_ARGS+=(--alarm-actions "$SNS_TOPIC_ARN" --ok-actions "$SNS_TOPIC_ARN")
else
  ALARM_ACTION_ARGS+=(--no-actions-enabled)
fi

put_log_retention() {
  local function_name="$1"
  local log_group_name="/aws/lambda/${function_name}"

  if aws logs describe-log-groups "${AWS_ARGS[@]}" \
    --log-group-name-prefix "$log_group_name" \
    --query "logGroups[?logGroupName=='${log_group_name}'].logGroupName | [0]" \
    --output text | grep -qx "$log_group_name"; then
    aws logs put-retention-policy "${AWS_ARGS[@]}" \
      --log-group-name "$log_group_name" \
      --retention-in-days "$LOG_RETENTION_DAYS"
  else
    echo "Skipping log retention. Log group does not exist yet: ${log_group_name}" >&2
  fi
}
put_lambda_error_alarm() {
  local function_name="$1"

  aws cloudwatch put-metric-alarm "${AWS_ARGS[@]}" \
    --alarm-name "${ALARM_PREFIX}-${function_name}-lambda-errors" \
    --alarm-description "Visora admin alert: ${function_name} has uncaught Lambda errors." \
    --namespace AWS/Lambda \
    --metric-name Errors \
    --dimensions "Name=FunctionName,Value=${function_name}" \
    --statistic Sum \
    --period 300 \
    --evaluation-periods 1 \
    --datapoints-to-alarm 1 \
    --threshold 1 \
    --comparison-operator GreaterThanOrEqualToThreshold \
    --treat-missing-data notBreaching \
    "${ALARM_ACTION_ARGS[@]}"
}

put_lambda_throttle_alarm() {
  local function_name="$1"

  aws cloudwatch put-metric-alarm "${AWS_ARGS[@]}" \
    --alarm-name "${ALARM_PREFIX}-${function_name}-lambda-throttles" \
    --alarm-description "Visora admin alert: ${function_name} is being throttled." \
    --namespace AWS/Lambda \
    --metric-name Throttles \
    --dimensions "Name=FunctionName,Value=${function_name}" \
    --statistic Sum \
    --period 300 \
    --evaluation-periods 1 \
    --datapoints-to-alarm 1 \
    --threshold 1 \
    --comparison-operator GreaterThanOrEqualToThreshold \
    --treat-missing-data notBreaching \
    "${ALARM_ACTION_ARGS[@]}"
}

put_api_gateway_alarm() {
  aws cloudwatch put-metric-alarm "${AWS_ARGS[@]}" \
    --alarm-name "${ALARM_PREFIX}-api-gateway-5xx" \
    --alarm-description "Visora admin alert: REST API Gateway is returning 5xx responses." \
    --namespace AWS/ApiGateway \
    --metric-name 5XXError \
    --dimensions "Name=ApiName,Value=${API_GATEWAY_NAME}" "Name=Stage,Value=${API_GATEWAY_STAGE}" \
    --statistic Sum \
    --period 300 \
    --evaluation-periods 1 \
    --datapoints-to-alarm 1 \
    --threshold 1 \
    --comparison-operator GreaterThanOrEqualToThreshold \
    --treat-missing-data notBreaching \
    "${ALARM_ACTION_ARGS[@]}"

  aws cloudwatch put-metric-alarm "${AWS_ARGS[@]}" \
    --alarm-name "${ALARM_PREFIX}-api-gateway-p95-latency" \
    --alarm-description "Visora admin alert: REST API Gateway p95 latency is high." \
    --namespace AWS/ApiGateway \
    --metric-name Latency \
    --dimensions "Name=ApiName,Value=${API_GATEWAY_NAME}" "Name=Stage,Value=${API_GATEWAY_STAGE}" \
    --extended-statistic p95 \
    --period 300 \
    --evaluation-periods 2 \
    --datapoints-to-alarm 2 \
    --threshold 8000 \
    --comparison-operator GreaterThanOrEqualToThreshold \
    --treat-missing-data notBreaching \
    "${ALARM_ACTION_ARGS[@]}"
}

put_sqs_alarm() {
  aws cloudwatch put-metric-alarm "${AWS_ARGS[@]}" \
    --alarm-name "${ALARM_PREFIX}-webhook-queue-backlog-age" \
    --alarm-description "Visora admin alert: webhook delivery queue has old messages." \
    --namespace AWS/SQS \
    --metric-name ApproximateAgeOfOldestMessage \
    --dimensions "Name=QueueName,Value=${WEBHOOK_DELIVERY_QUEUE_NAME}" \
    --statistic Maximum \
    --period 300 \
    --evaluation-periods 2 \
    --datapoints-to-alarm 2 \
    --threshold 300 \
    --comparison-operator GreaterThanOrEqualToThreshold \
    --treat-missing-data notBreaching \
    "${ALARM_ACTION_ARGS[@]}"

  aws cloudwatch put-metric-alarm "${AWS_ARGS[@]}" \
    --alarm-name "${ALARM_PREFIX}-webhook-dlq-visible-messages" \
    --alarm-description "Visora admin alert: webhook delivery DLQ has messages." \
    --namespace AWS/SQS \
    --metric-name ApproximateNumberOfMessagesVisible \
    --dimensions "Name=QueueName,Value=${WEBHOOK_DELIVERY_DLQ_NAME}" \
    --statistic Maximum \
    --period 300 \
    --evaluation-periods 1 \
    --datapoints-to-alarm 1 \
    --threshold 1 \
    --comparison-operator GreaterThanOrEqualToThreshold \
    --treat-missing-data notBreaching \
    "${ALARM_ACTION_ARGS[@]}"
}

put_dashboard() {
  local dashboard_file
  dashboard_file="$(mktemp)"

  cat > "$dashboard_file" <<DASHBOARD_JSON
{
  "widgets": [
    {
      "type": "text",
      "x": 0,
      "y": 0,
      "width": 24,
      "height": 2,
      "properties": {
        "markdown": "# Visora Admin Observability\\nMinimal CloudWatch view for Lambda health, API Gateway 5xx/latency, webhook queue health, and recent Lambda errors. No custom metrics are required."
      }
    },
    {
      "type": "metric",
      "x": 0,
      "y": 2,
      "width": 12,
      "height": 6,
      "properties": {
        "region": "${REGION}",
        "title": "Lambda errors",
        "view": "timeSeries",
        "stacked": false,
        "period": 300,
        "stat": "Sum",
        "metrics": [
          [ "AWS/Lambda", "Errors", "FunctionName", "${AUTH_LAMBDA_FUNCTION_NAME}", { "label": "auth" } ],
          [ ".", ".", ".", "${DASHBOARD_LAMBDA_FUNCTION_NAME}", { "label": "dashboard" } ],
          [ ".", ".", ".", "${MODERATION_LAMBDA_FUNCTION_NAME}", { "label": "moderation" } ],
          [ ".", ".", ".", "${WEBHOOK_LAMBDA_FUNCTION_NAME}", { "label": "webhook worker" } ]
        ]
      }
    },
    {
      "type": "metric",
      "x": 12,
      "y": 2,
      "width": 12,
      "height": 6,
      "properties": {
        "region": "${REGION}",
        "title": "Lambda p95 duration",
        "view": "timeSeries",
        "stacked": false,
        "period": 300,
        "stat": "p95",
        "metrics": [
          [ "AWS/Lambda", "Duration", "FunctionName", "${AUTH_LAMBDA_FUNCTION_NAME}", { "label": "auth" } ],
          [ ".", ".", ".", "${DASHBOARD_LAMBDA_FUNCTION_NAME}", { "label": "dashboard" } ],
          [ ".", ".", ".", "${MODERATION_LAMBDA_FUNCTION_NAME}", { "label": "moderation" } ],
          [ ".", ".", ".", "${WEBHOOK_LAMBDA_FUNCTION_NAME}", { "label": "webhook worker" } ]
        ]
      }
    },
    {
      "type": "metric",
      "x": 0,
      "y": 8,
      "width": 12,
      "height": 6,
      "properties": {
        "region": "${REGION}",
        "title": "API Gateway traffic and errors",
        "view": "timeSeries",
        "stacked": false,
        "period": 300,
        "stat": "Sum",
        "metrics": [
          [ "AWS/ApiGateway", "Count", "ApiName", "${API_GATEWAY_NAME}", "Stage", "${API_GATEWAY_STAGE}", { "label": "requests" } ],
          [ ".", "4XXError", ".", ".", ".", ".", { "label": "4xx" } ],
          [ ".", "5XXError", ".", ".", ".", ".", { "label": "5xx" } ]
        ]
      }
    },
    {
      "type": "metric",
      "x": 12,
      "y": 8,
      "width": 12,
      "height": 6,
      "properties": {
        "region": "${REGION}",
        "title": "API Gateway latency",
        "view": "timeSeries",
        "stacked": false,
        "period": 300,
        "stat": "p95",
        "metrics": [
          [ "AWS/ApiGateway", "Latency", "ApiName", "${API_GATEWAY_NAME}", "Stage", "${API_GATEWAY_STAGE}", { "label": "p95 latency" } ],
          [ ".", "IntegrationLatency", ".", ".", ".", ".", { "label": "p95 integration latency" } ]
        ]
      }
    },
    {
      "type": "metric",
      "x": 0,
      "y": 14,
      "width": 12,
      "height": 6,
      "properties": {
        "region": "${REGION}",
        "title": "Webhook queue health",
        "view": "timeSeries",
        "stacked": false,
        "period": 300,
        "metrics": [
          [ "AWS/SQS", "ApproximateNumberOfMessagesVisible", "QueueName", "${WEBHOOK_DELIVERY_QUEUE_NAME}", { "label": "queue visible", "stat": "Maximum" } ],
          [ ".", "ApproximateAgeOfOldestMessage", ".", ".", { "label": "queue oldest age", "stat": "Maximum" } ],
          [ ".", "ApproximateNumberOfMessagesVisible", ".", "${WEBHOOK_DELIVERY_DLQ_NAME}", { "label": "dlq visible", "stat": "Maximum" } ]
        ]
      }
    },
    {
      "type": "metric",
      "x": 12,
      "y": 14,
      "width": 12,
      "height": 6,
      "properties": {
        "region": "${REGION}",
        "title": "Lambda throttles",
        "view": "timeSeries",
        "stacked": false,
        "period": 300,
        "stat": "Sum",
        "metrics": [
          [ "AWS/Lambda", "Throttles", "FunctionName", "${AUTH_LAMBDA_FUNCTION_NAME}", { "label": "auth" } ],
          [ ".", ".", ".", "${DASHBOARD_LAMBDA_FUNCTION_NAME}", { "label": "dashboard" } ],
          [ ".", ".", ".", "${MODERATION_LAMBDA_FUNCTION_NAME}", { "label": "moderation" } ],
          [ ".", ".", ".", "${WEBHOOK_LAMBDA_FUNCTION_NAME}", { "label": "webhook worker" } ]
        ]
      }
    },
    {
      "type": "log",
      "x": 0,
      "y": 20,
      "width": 24,
      "height": 8,
      "properties": {
        "region": "${REGION}",
        "title": "Recent Lambda errors",
        "query": "SOURCE '/aws/lambda/${AUTH_LAMBDA_FUNCTION_NAME}' | SOURCE '/aws/lambda/${DASHBOARD_LAMBDA_FUNCTION_NAME}' | SOURCE '/aws/lambda/${MODERATION_LAMBDA_FUNCTION_NAME}' | SOURCE '/aws/lambda/${WEBHOOK_LAMBDA_FUNCTION_NAME}' | SOURCE '/aws/lambda/${REDACTION_LAMBDA_FUNCTION_NAME}' | fields @timestamp, @log, @message | filter @message like /ERROR|Error|AccessDenied|Task timed out|Runtime.ExitError/ | sort @timestamp desc | limit 50",
        "view": "table"
      }
    }
  ]
}
DASHBOARD_JSON

  aws cloudwatch put-dashboard "${AWS_ARGS[@]}" \
    --dashboard-name "$DASHBOARD_NAME" \
    --dashboard-body "file://${dashboard_file}"

  rm -f "$dashboard_file"
}

main() {
  put_dashboard

  for function_name in \
    "$AUTH_LAMBDA_FUNCTION_NAME" \
    "$DASHBOARD_LAMBDA_FUNCTION_NAME" \
    "$MODERATION_LAMBDA_FUNCTION_NAME" \
    "$WEBHOOK_LAMBDA_FUNCTION_NAME" \
    "$REDACTION_LAMBDA_FUNCTION_NAME"
  do
    put_log_retention "$function_name"
    put_lambda_error_alarm "$function_name"
    put_lambda_throttle_alarm "$function_name"
  done

  put_api_gateway_alarm
  put_sqs_alarm

  cat <<END_MESSAGE
CloudWatch observability configured.

Dashboard:
  ${DASHBOARD_NAME}

Alarms:
  Prefix: ${ALARM_PREFIX}
  SNS actions: ${SNS_TOPIC_ARN:-not configured}
  Log retention days: ${LOG_RETENTION_DAYS}

Region:
  ${REGION}
END_MESSAGE
}

main "$@"

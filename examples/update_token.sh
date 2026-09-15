#!/bin/bash
# Usage: update_token.sh [USER] [PASSWORD]

CONFIG_FILE="./config/config.json"
if [ ! -f "$CONFIG_FILE" ]; then
  echo "❌ Config file not found: $CONFIG_FILE"
  exit 1
fi

# OFBiz token issuance URL
BACKEND_API_AUTH="https://demo-stable.ofbiz.apache.org/rest/auth/token"

# Allow USER and PASSWORD as positional args or environment variables

USER_ARG="$1"
PASS_ARG="$2"

if [ -n "$USER_ARG" ] && [ -n "$PASS_ARG" ]; then
  AUTH_USER="$USER_ARG"
  AUTH_PASS="$PASS_ARG"
fi

if [ -z "$AUTH_USER" ] || [ -z "$AUTH_PASS" ]; then
  echo "❌ Missing USER and PASSWORD. Provide as arguments or set AUTH_USER and AUTH_PASS env vars."
  exit 1
fi

# Compute Basic auth header value (base64 of user:pass)
AUTH_B64=$(printf "%s:%s" "$AUTH_USER" "$AUTH_PASS" | base64)

# Build curl command
CMD=(curl -s -k -X POST "$BACKEND_API_AUTH" \
  -H "accept: application/json" \
  -H "Authorization: Basic $AUTH_B64")

# Execute curl command and capture response
RESPONSE=$("${CMD[@]}")

# Extract access_token from JSON response
ACCESS_TOKEN=$(echo "$RESPONSE" | jq -r '.data.access_token')

if [ -z "$ACCESS_TOKEN" ] || [ "$ACCESS_TOKEN" == "null" ]; then
  echo "❌ Failed to retrieve access_token"
  echo "Response was: $RESPONSE"
  exit 1
fi

echo "✅ Retrieved access_token: $ACCESS_TOKEN"

# Update ./config/config.json with new token

# Update BACKEND_AUTH_TOKEN field
TMP_FILE=$(mktemp)
jq --arg token "$ACCESS_TOKEN" '.BACKEND_ACCESS_TOKEN = $token' "$CONFIG_FILE" > "$TMP_FILE" 

cat "$TMP_FILE" > "$CONFIG_FILE"
rm "$TMP_FILE"

echo "✅ Updated $CONFIG_FILE with new BACKEND_ACCESS_TOKEN"

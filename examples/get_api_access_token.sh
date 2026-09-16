#!/bin/bash
# Usage: get_api_access_token.sh [USER] [PASSWORD] [CONFIGURATION FILE]

# OFBiz token issuance URL
BACKEND_API_AUTH="https://demo-stable.ofbiz.apache.org/rest/auth/token"

# Allow USER, PASSWORD and CONFIGURATION FILE as positional args or environment variables

USER_ARG="$1"
PASS_ARG="$2"
CONFIG_FILE_ARG="$3"

if [ -n "$USER_ARG" ] && [ -n "$PASS_ARG" ] && [ -n "$CONFIG_FILE_ARG" ]; then
  AUTH_USER="$USER_ARG"
  AUTH_PASS="$PASS_ARG"
  CONFIG_FILE="$CONFIG_FILE_ARG"
fi

if [ -z "$AUTH_USER" ] || [ -z "$AUTH_PASS" ] || [ -z "$CONFIG_FILE" ]; then
  echo "❌ Missing USER, PASSWORD, or CONFIGURATION FILE. Use get_api_access_token.sh [USER] [PASSWORD] [CONFIGURATION FILE] or set corresponding env vars: AUTH_USER, AUTH_PASS, CONFIG_FILE."
  exit 1
fi

if [ ! -f "$CONFIG_FILE" ]; then
  echo "❌ Configuration file not found: $CONFIG_FILE"
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

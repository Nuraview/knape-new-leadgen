#!/bin/sh
set -e

echo "Starting environment variable replacement..."

# Process NURAVIEW_API_URL first (with special handling)
if [ ! -z "$NURAVIEW_API_URL" ]; then
  echo "Found NURAVIEW_API_URL: $NURAVIEW_API_URL"

  # First, replace the exact string "NURAVIEW_API_URL" in all JavaScript files
  # Use grep -l to only process files that contain the string
  find /usr/share/nginx/html -type f -name "*.js" -exec grep -l "NURAVIEW_API_URL" {} \; | xargs -r sed -i "s#NURAVIEW_API_URL#$NURAVIEW_API_URL#g"

  # Also check for the escaped version which might appear in some files
  find /usr/share/nginx/html -type f -name "*.js" -exec grep -l "\"NURAVIEW_API_URL\"" {} \; | xargs -r sed -i "s#\"NURAVIEW_API_URL\"#\"$NURAVIEW_API_URL\"#g"

  # Build MCP OAuth discovery JSON for nginx to serve at /.well-known
  BASE_URL=$(echo "$NURAVIEW_API_URL" | sed 's#/api/*$##')
  PRM_JSON="{\"resource\":\"${BASE_URL}/api/mcp\",\"authorization_servers\":[\"${BASE_URL}/api\"]}"
  AS_JSON="{\"issuer\":\"${BASE_URL}/api\",\"authorization_endpoint\":\"${BASE_URL}/api/mcp/authorize\",\"token_endpoint\":\"${BASE_URL}/api/mcp/token\",\"registration_endpoint\":\"${BASE_URL}/api/mcp/register\",\"response_types_supported\":[\"code\"],\"grant_types_supported\":[\"authorization_code\"],\"code_challenge_methods_supported\":[\"S256\"],\"token_endpoint_auth_methods_supported\":[\"none\"]}"
  sed -i "s#MCP_PRM_JSON_PLACEHOLDER#$PRM_JSON#g" /etc/nginx/conf.d/default.conf
  sed -i "s#MCP_AS_JSON_PLACEHOLDER#$AS_JSON#g" /etc/nginx/conf.d/default.conf

  echo "✅ Replaced NURAVIEW_API_URL with $NURAVIEW_API_URL"
else
  echo "WARNING: NURAVIEW_API_URL environment variable is not set. API calls may fail."
  # No API URL — remove MCP placeholders so nginx doesn't serve broken JSON
  sed -i "s#MCP_PRM_JSON_PLACEHOLDER#{}#g" /etc/nginx/conf.d/default.conf
  sed -i "s#MCP_AS_JSON_PLACEHOLDER#{}#g" /etc/nginx/conf.d/default.conf
fi

# Process NURAVIEW_CLIENT_URL efficiently
if [ ! -z "$NURAVIEW_CLIENT_URL" ]; then
  echo "Found NURAVIEW_CLIENT_URL: $NURAVIEW_CLIENT_URL"
  
  # Only process files that actually contain the string
  find /usr/share/nginx/html -type f -name "*.js" -exec grep -l "NURAVIEW_CLIENT_URL" {} \; | xargs -r sed -i "s#NURAVIEW_CLIENT_URL#$NURAVIEW_CLIENT_URL#g"
  find /usr/share/nginx/html -type f -name "*.js" -exec grep -l "\"NURAVIEW_CLIENT_URL\"" {} \; | xargs -r sed -i "s#\"NURAVIEW_CLIENT_URL\"#\"$NURAVIEW_CLIENT_URL\"#g"
  
  echo "✅ Replaced NURAVIEW_CLIENT_URL with $NURAVIEW_CLIENT_URL"
fi

# Process any other NURAVIEW_ prefixed environment variables (for future extensibility)
# Exclude the ones we've already processed
for key in $(env | grep '^NURAVIEW_' | grep -v 'NURAVIEW_API_URL\|NURAVIEW_CLIENT_URL' | cut -d= -f1); do
  value=$(printenv "$key")
  
  if [ ! -z "$value" ]; then
    echo "Found $key: $value"
    
    # Only process files that contain this specific key
    find /usr/share/nginx/html -type f \( -name "*.js" -o -name "*.css" \) -exec grep -l "$key" {} \; | xargs -r sed -i "s#$key#$value#g"
    
    echo "✅ Replaced $key with $value"
  fi
done

# Empty any remaining `"NURAVIEW_*"` placeholder whose env var was left unset.
# Without this, the literal placeholder stays in the bundle and is read by
# the frontend as a truthy string — which broke self-hosted signup when
# NURAVIEW_TURNSTILE_SITE_KEY was left unset (issue #1304). Apply to any future
# runtime-substituted flag so the same trap doesn't recur.
echo "Stripping unset NURAVIEW_* placeholders..."
find /usr/share/nginx/html -type f \( -name "*.js" -o -name "*.css" \) \
  -exec grep -lE '"NURAVIEW_[A-Z_]+"' {} \; \
  | xargs -r sed -i -E 's#"NURAVIEW_[A-Z_]+"#""#g'

echo "✅ Environment variable replacement complete"

#!/bin/sh
set -e

# Print version banner
echo "════════════════════════════════════════════════════════════════════"
echo "  AppFlowy Web v${APP_VERSION:-dev}"
echo "════════════════════════════════════════════════════════════════════"
echo ""

# Backward compatibility: Map old environment variable names to new ones
if [ -n "${AF_BASE_URL}" ] && [ -z "${APPFLOWY_BASE_URL}" ]; then
  echo "⚠️  WARNING: AF_BASE_URL is deprecated. Please use APPFLOWY_BASE_URL instead."
  export APPFLOWY_BASE_URL="${AF_BASE_URL}"
fi

if [ -n "${AF_GOTRUE_URL}" ] && [ -z "${APPFLOWY_GOTRUE_BASE_URL}" ]; then
  echo "⚠️  WARNING: AF_GOTRUE_URL is deprecated. Please use APPFLOWY_GOTRUE_BASE_URL instead."
  export APPFLOWY_GOTRUE_BASE_URL="${AF_GOTRUE_URL}"
fi

# Support both AF_WS_V2_URL and AF_WS_URL for backward compatibility
if [ -n "${AF_WS_V2_URL}" ] && [ -z "${APPFLOWY_WS_BASE_URL}" ]; then
  echo "⚠️  WARNING: AF_WS_V2_URL is deprecated. Please use APPFLOWY_WS_BASE_URL instead."
  export APPFLOWY_WS_BASE_URL="${AF_WS_V2_URL}"
elif [ -n "${AF_WS_URL}" ] && [ -z "${APPFLOWY_WS_BASE_URL}" ]; then
  echo "⚠️  WARNING: AF_WS_URL is deprecated. Please use APPFLOWY_WS_BASE_URL instead."
  export APPFLOWY_WS_BASE_URL="${AF_WS_URL}"
fi

# Check required environment variables (after mapping)
if [ -z "${APPFLOWY_BASE_URL}" ]; then
  echo "ERROR: APPFLOWY_BASE_URL environment variable is required but not set"
  echo "Please set APPFLOWY_BASE_URL to your AppFlowy backend URL (e.g., https://your-backend.example.com)"
  echo "Note: You can also use the deprecated AF_BASE_URL for backward compatibility"
  exit 1
fi

if [ -z "${APPFLOWY_GOTRUE_BASE_URL}" ]; then
  echo "ERROR: APPFLOWY_GOTRUE_BASE_URL environment variable is required but not set"
  echo "Please set APPFLOWY_GOTRUE_BASE_URL to your GoTrue authentication service URL (e.g., https://your-backend.example.com/gotrue)"
  echo "Note: You can also use the deprecated AF_GOTRUE_URL for backward compatibility"
  exit 1
fi

if [ -z "${APPFLOWY_WS_BASE_URL}" ]; then
  echo "ERROR: APPFLOWY_WS_BASE_URL environment variable is required but not set"
  echo "Please set APPFLOWY_WS_BASE_URL to your WebSocket URL (e.g., wss://your-backend.example.com/ws/v2)"
  echo "Note: You can also use the deprecated AF_WS_V2_URL or AF_WS_URL for backward compatibility"
  exit 1
fi

# Show deprecation summary if any old variables were used
if [ -n "${AF_BASE_URL}" ] || [ -n "${AF_GOTRUE_URL}" ] || [ -n "${AF_WS_V2_URL}" ] || [ -n "${AF_WS_URL}" ]; then
  echo ""
  echo "════════════════════════════════════════════════════════════════════"
  echo "⚠️  DEPRECATION NOTICE: Old environment variable names detected!"
  echo "Please update your configuration to use the new names:"
  echo "  AF_BASE_URL      → APPFLOWY_BASE_URL"
  echo "  AF_GOTRUE_URL    → APPFLOWY_GOTRUE_BASE_URL"
  echo "  AF_WS_V2_URL     → APPFLOWY_WS_BASE_URL"
  echo "  AF_WS_URL        → APPFLOWY_WS_BASE_URL"
  echo "════════════════════════════════════════════════════════════════════"
  echo ""
fi

# IMPORTANT: For client-side React app, inject config into HTML
CONFIG_SCRIPT="<script>window.__APP_CONFIG__={APPFLOWY_BASE_URL:'${APPFLOWY_BASE_URL}',APPFLOWY_GOTRUE_BASE_URL:'${APPFLOWY_GOTRUE_BASE_URL}',APPFLOWY_WS_BASE_URL:'${APPFLOWY_WS_BASE_URL}'};</script>"

# Inject the config script into both nginx and Bun server locations
sed -i "s|</head>|${CONFIG_SCRIPT}</head>|g" /usr/share/nginx/html/index.html
sed -i "s|</head>|${CONFIG_SCRIPT}</head>|g" /app/dist/index.html

echo "Environment variables configured:"
echo "  APPFLOWY_BASE_URL: ${APPFLOWY_BASE_URL}"
echo "  APPFLOWY_GOTRUE_BASE_URL: ${APPFLOWY_GOTRUE_BASE_URL}"
echo "  APPFLOWY_WS_BASE_URL: ${APPFLOWY_WS_BASE_URL}"
echo ""

# Export for Bun server to use
export APPFLOWY_BASE_URL
export APPFLOWY_GOTRUE_BASE_URL
export APPFLOWY_WS_BASE_URL

# Start supervisor to manage both nginx and Bun server
# Supervisor will inherit the exported environment variables
exec supervisord -c /etc/supervisor/conf.d/supervisord.conf
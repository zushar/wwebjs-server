#!/bin/sh
set -e

# Check if Chrome is running and responding
if ! curl -s http://localhost:9222/json/version > /dev/null; then
  echo "Chrome is not responding on localhost:9222"
  exit 1
fi

# Check if socat is listening on all interfaces
if ! netstat -tulpn | grep -q "0.0.0.0:9222"; then
  echo "Port 9222 is not being forwarded to all interfaces"
  exit 1
fi

# All checks passed
echo "Chrome is healthy"
exit 0

#!/bin/bash
set -e

# Find Chrome binary
CHROME_PATH=$(find /home/pptruser/.cache/puppeteer/chrome/ -name chrome -type f -executable 2>/dev/null | head -n 1)

if [ -z "$CHROME_PATH" ]; then
  echo "Chrome not found in Puppeteer cache, looking in standard locations..."
  for cmd in google-chrome-stable chrome chromium chromium-browser; do
    if command -v "$cmd" >/dev/null 2>&1; then
      CHROME_PATH=$(command -v "$cmd")
      break
    fi
  done
fi

if [ -z "$CHROME_PATH" ]; then
  echo "Chrome not found!"
  exit 1
fi

echo "Starting Chrome at: $CHROME_PATH"

# Kill any existing Chrome processes
pkill -f chrome || true

# Check if socat is available
if command -v socat >/dev/null 2>&1; then
  echo "Socat is available, will use it for port forwarding"
  # Kill any existing socat processes
  pkill socat || true
  USE_SOCAT=true
else
  echo "WARNING: socat is not installed. Will try to use Chrome's remote debugging address directly."
  USE_SOCAT=false
fi

# Run Chrome with remote debugging enabled
if [ "$USE_SOCAT" = true ]; then
  # If using socat, bind Chrome to localhost only
  echo "Starting Chrome with remote debugging on localhost:9222"
  "$CHROME_PATH" \
    --headless=new \
    --no-sandbox \
    --disable-setuid-sandbox \
    --disable-gpu \
    --disable-gpu-sandbox \
    --disable-software-rasterizer \
    --disable-dev-shm-usage \
    --remote-debugging-port=9222 \
    --remote-allow-origins=* \
    --no-first-run \
    --no-default-browser-check &
else
  # If not using socat, try to bind Chrome to all interfaces
  echo "Starting Chrome with remote debugging on 0.0.0.0:9222"
  "$CHROME_PATH" \
    --headless=new \
    --no-sandbox \
    --disable-setuid-sandbox \
    --disable-gpu \
    --disable-gpu-sandbox \
    --disable-software-rasterizer \
    --disable-dev-shm-usage \
    --remote-debugging-address=0.0.0.0 \
    --remote-debugging-port=9222 \
    --remote-allow-origins=* \
    --no-first-run \
    --no-default-browser-check &
fi

CHROME_PID=$!

# Wait for Chrome to start listening on port 9222
echo "Waiting for Chrome to start listening on port 9222..."
for i in $(seq 1 30); do
  if curl -s http://localhost:9222/json/version > /dev/null; then
    echo "Chrome is now listening on port 9222"
    break
  fi
  echo "Waiting for Chrome to start... ($i/30)"
  sleep 1
done

# Check if Chrome is listening
echo "Checking if Chrome is listening..."
netstat -tulpn | grep 9222

# If socat is available, use it to forward ports
if [ "$USE_SOCAT" = true ]; then
  # Start socat in the background to forward connections
  echo "Starting socat to forward connections from 0.0.0.0:9223 to 127.0.0.1:9222"
  socat TCP-LISTEN:9223,fork,reuseaddr,bind=0.0.0.0 TCP:127.0.0.1:9222 &
  SOCAT_PID=$!

  # Wait a moment for socat to start
  sleep 2

  # Verify socat is listening
  echo "Verifying socat is listening on 0.0.0.0:9223..."
  netstat -tulpn | grep 9223
  
  echo "Browser pool is ready! Chrome is accessible via port 9223"
else
  echo "Browser pool is ready! Chrome should be accessible via port 9222"
fi

# Keep the container running
wait $CHROME_PID

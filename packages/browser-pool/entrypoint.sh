#!/bin/sh
set -e
PUPPETEER_CHROME_PATH=$(find /home/pptruser/.cache/puppeteer/chrome/ -name chrome -type f -executable 2>/dev/null | head -n 1)

if [ -n "$PUPPETEER_CHROME_PATH" ]; then
  BROWSER_CMD="$PUPPETEER_CHROME_PATH"
else
  echo >&2 "Puppeteer Chrome cache not found, searching standard paths..."
  for cmd in google-chrome-stable chrome chromium chromium-browser chrome-headless-shell; do
    if command -v "$cmd" >/dev/null 2>&1; then
      BROWSER_CMD=$(command -v "$cmd")
      break
    fi
  done
fi

if [ -n "$BROWSER_CMD" ] && [ -x "$BROWSER_CMD" ]; then
  echo "Found browser binary at: $BROWSER_CMD"
  
  # Kill any existing socat processes
  pkill socat || true
  
  # Start Chrome with debugging enabled on localhost
  echo "Starting Chrome with remote debugging on 127.0.0.1:9222"
  
  # Launch Chrome in the background
  "$BROWSER_CMD" \
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
  
  # Store the Chrome process ID
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
  
  # Start socat in the background to forward connections
  echo "Starting socat to forward connections from 0.0.0.0:9222 to 127.0.0.1:9222"
  socat TCP-LISTEN:9222,fork,reuseaddr,bind=0.0.0.0 TCP:127.0.0.1:9222 &
  SOCAT_PID=$!
  
  # Wait a moment for socat to start
  sleep 2
  
  # Verify socat is running and listening
  echo "Verifying socat is listening on 0.0.0.0:9222..."
  netstat -tulpn | grep 9222
  
  # Keep the container running
  echo "Browser pool is ready!"
  
  # Wait for Chrome to exit
  wait $CHROME_PID
else
  echo >&2 "Could not find a suitable browser binary!"
  exit 1
fi

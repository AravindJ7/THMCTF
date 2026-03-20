#!/bin/sh
# Start internal flag service in background (binds only to 127.0.0.1:8080)
node /app/internal/server.js &

# Start main web app
exec node /app/server.js

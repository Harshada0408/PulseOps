#!/bin/sh
# Starts the Express API and the monitoring worker in a single container.
# The worker (background checks) needs no public port; the API listens on 3001.
# POSIX-only: Render's image uses dash, so no bashisms (no `wait -n`).

echo "[entrypoint] starting API + worker"

# Worker: run in background from /app/worker
(cd /app/worker && node dist/index.js) &
WORKER_PID=$!

# API: foreground so Render tracks its lifecycle
node /app/backend/dist/server.js &
API_PID=$!

# Forward signals to both children
trap 'kill $API_PID $WORKER_PID 2>/dev/null || true' INT TERM

# Restart children if they exit unexpectedly; keep the container alive
while true; do
  if ! kill -0 $API_PID 2>/dev/null; then
    echo "[entrypoint] API exited — restarting"
    node /app/backend/dist/server.js &
    API_PID=$!
  fi
  if ! kill -0 $WORKER_PID 2>/dev/null; then
    echo "[entrypoint] worker exited — restarting"
    (cd /app/worker && node dist/index.js) &
    WORKER_PID=$!
  fi
  sleep 2
done
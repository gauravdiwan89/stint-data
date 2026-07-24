#!/bin/bash

set -u

APP_DIR="$(cd "$(dirname "$0")" && pwd)"
LOG_DIR="$APP_DIR/logs"
PYTHON="$APP_DIR/.venv/bin/python"
WEBPACK="$APP_DIR/node_modules/.bin/webpack"
BRIDGE_PORT="${FASTF1_BRIDGE_PORT:-5050}"
UI_PORT="${F1_UI_PORT:-8080}"
APP_URL="http://127.0.0.1:$UI_PORT/"

mkdir -p "$LOG_DIR"
cd "$APP_DIR" || exit 1

export PATH="/opt/homebrew/bin:/usr/local/bin:$APP_DIR/node_modules/.bin:/Users/gaurav/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH"
export PORT="$BRIDGE_PORT"

echo "Starting F1 Live Lap Times..."
echo "Project: $APP_DIR"
echo

if [ ! -x "$PYTHON" ]; then
    echo "Could not find the Python virtualenv at:"
    echo "$PYTHON"
    echo
    echo "Run this once from the project folder:"
    echo "python3 -m venv .venv"
    echo ".venv/bin/python -m pip install -r requirements.txt"
    echo
    read -r -p "Press return to close..."
    exit 1
fi

if [ ! -x "$WEBPACK" ]; then
    echo "Could not find webpack at:"
    echo "$WEBPACK"
    echo
    echo "Run this once from the project folder:"
    echo "pnpm install --no-frozen-lockfile"
    echo
    read -r -p "Press return to close..."
    exit 1
fi

if ! command -v node >/dev/null 2>&1; then
    echo "Could not find node on PATH."
    echo "Install Node.js, or start the app from Codex where the bundled Node runtime is available."
    echo
    read -r -p "Press return to close..."
    exit 1
fi

wait_for_url() {
    local url="$1"
    local name="$2"
    local attempts="${3:-40}"
    local delay="${4:-1}"

    for ((i = 1; i <= attempts; i++)); do
        if curl -fsS "$url" >/dev/null 2>&1; then
            echo "$name is ready."
            return 0
        fi
        sleep "$delay"
    done

    echo "$name did not become ready in time."
    return 1
}

if curl -fsS "http://127.0.0.1:$BRIDGE_PORT/health" >/dev/null 2>&1; then
    echo "FastF1 bridge is already running on port $BRIDGE_PORT."
else
    echo "Starting FastF1 bridge on port $BRIDGE_PORT..."
    nohup "$PYTHON" scripts/fastf1_bridge.py --port "$BRIDGE_PORT" > "$LOG_DIR/fastf1_bridge.log" 2>&1 &
    echo $! > "$LOG_DIR/fastf1_bridge.pid"
    disown 2>/dev/null || true
    wait_for_url "http://127.0.0.1:$BRIDGE_PORT/health" "FastF1 bridge" 45 1 || {
        echo
        echo "Bridge log:"
        tail -n 40 "$LOG_DIR/fastf1_bridge.log"
        read -r -p "Press return to close..."
        exit 1
    }
fi

if curl -fsS "$APP_URL" >/dev/null 2>&1; then
    echo "UI is already running on port $UI_PORT."
else
    echo "Starting UI on port $UI_PORT..."
    nohup "$WEBPACK" serve --config webpack.dev.js --host 127.0.0.1 --port "$UI_PORT" > "$LOG_DIR/webpack_dev.log" 2>&1 &
    echo $! > "$LOG_DIR/webpack_dev.pid"
    disown 2>/dev/null || true
    wait_for_url "$APP_URL" "UI" 60 1 || {
        echo
        echo "UI log:"
        tail -n 60 "$LOG_DIR/webpack_dev.log"
        read -r -p "Press return to close..."
        exit 1
    }
fi

echo
echo "Opening $APP_URL"
open "$APP_URL"
echo
echo "App is running. Logs are in:"
echo "$LOG_DIR"
echo
echo "You can close this Terminal window; the servers will keep running in the background."
echo "To stop them later, run:"
echo "kill \$(cat \"$LOG_DIR/fastf1_bridge.pid\") \$(cat \"$LOG_DIR/webpack_dev.pid\")"
echo
read -r -p "Press return to close this window..."

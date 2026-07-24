#!/bin/bash

set -u

APP_DIR="$(cd "$(dirname "$0")" && pwd)"
LOG_DIR="$APP_DIR/logs"

stop_pid_file() {
    local pid_file="$1"
    local name="$2"

    if [ ! -f "$pid_file" ]; then
        echo "$name is not tracked as running."
        return
    fi

    local pid
    pid="$(cat "$pid_file")"

    if kill -0 "$pid" >/dev/null 2>&1; then
        echo "Stopping $name ($pid)..."
        kill "$pid"
    else
        echo "$name process $pid is not running."
    fi

    rm -f "$pid_file"
}

echo "Stopping F1 Live Lap Times..."
stop_pid_file "$LOG_DIR/fastf1_bridge.pid" "FastF1 bridge"
stop_pid_file "$LOG_DIR/webpack_dev.pid" "UI"
echo "Done."
echo
read -r -p "Press return to close this window..."

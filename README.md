# FastF1 Stint Data

This project is built from [`rakesh-i/stint-data`](https://github.com/rakesh-i/stint-data). The UI stays close to the original: pick season, race, session, and drivers; fetch stint data; then selected driver stints are appended as columns in the lap-time table.

## What Changed

- The frontend still expects OpenF1-style endpoints.
- `scripts/fastf1_bridge.py` adapts FastF1 data into those endpoints:
  - `/v1/meetings`
  - `/v1/sessions`
  - `/v1/drivers`
  - `/v1/laps`
  - `/v1/stints`
- Stints from the same driver remain together because the original table groups each driver's stint columns under one driver header.
- Lap cells show both the real lap number and the formatted lap time.

## Run

Install JavaScript dependencies:

```bash
pnpm install --no-frozen-lockfile
```

Install the FastF1 bridge dependencies:

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
```

Start the FastF1 bridge:

```bash
.venv/bin/python scripts/fastf1_bridge.py --year 2026 --gp Hungary --session R
```

Start the UI:

```bash
webpack serve --config webpack.dev.js --host 127.0.0.1
```

Open:

```text
http://127.0.0.1:8080/
```

## Notes On Live Data

The previous prototype showed sample lap data when the bridge was not running. This version does not use seeded drivers for the main flow; it asks the FastF1 bridge for meetings, sessions, drivers, laps, and stints.

FastF1 can load processed timing data via `fastf1.get_session(...).load()` and `session.laps`. Its live-timing recorder is lower-level and primarily records the stream for later processing, so truly in-session behavior depends on what FastF1 can fetch/process for the current session at that moment.

## Live Mode

Click `LIVE MODE` in the app to ask the FastF1 bridge which F1 session is currently inside its live window. If there is no live session, the app shows `No live session at the moment`. The bridge uses the FastF1 schedule with realistic session durations plus a small 10-minute buffer before and after each session, so an archived live-timing snapshot after a session has finished is not treated as live.

When a live session is found, the bridge starts recording the FastF1 SignalR live timing stream into `live-recordings/`, parses the raw messages as they arrive, and exposes driver, lap, and stint rows through the same OpenF1-style endpoints the table already uses. Once the driver list arrives, choose the drivers you want and click `SEARCH`; the table will append their stint columns and refresh every 5 seconds.

The refresh interval is intentionally 5 seconds. Lap-time/stint data changes only when cars complete laps, so faster polling mostly reparses the same raw file and makes the UI feel busier without improving the table. If needed, change the returned `poll_interval_ms` in `scripts/fastf1_bridge.py`.

If the live recording file remains empty, FastF1 may be waiting for F1TV authentication. Watch the bridge terminal for the auth URL, complete the login once, then restart live mode.

## F1TV Authentication

FastF1's docs say F1TV authentication is currently only required for the Live Timing Client. Post-session data can be accessed without authentication.

Check auth status:

```bash
.venv/bin/python scripts/fastf1_bridge.py --auth-status
```

Start the F1TV browser authentication flow:

```bash
.venv/bin/python scripts/fastf1_bridge.py --authenticate-f1tv
```

Record live timing data during a session:

```bash
.venv/bin/python -m fastf1.livetiming save live-session.txt
```

Preview a saved live timing file:

```bash
.venv/bin/python scripts/inspect_livetiming.py live-session.txt --examples 1
```

Load a recorded live timing file through the bridge:

```bash
.venv/bin/python scripts/fastf1_bridge.py --year 2026 --gp Hungary --session R --livedata live-session.txt --force-refresh
```

Important: FastF1's live timing client records raw live timing data. The official docs state that this data cannot be processed in real time during the session; it is meant to be loaded and processed after recording.

## Live Timing File Shape

The normal saved file is newline-delimited raw text. Each line is a Python-style list with:

```text
['CategoryName', '{"json":"payload"}', '2026-07-26T13:05:31.000Z']
```

Useful categories for our own stint table processor:

- `DriverList`: driver numbers, TLAs, broadcast names, team names, team colors
- `TimingData`: lap number, last lap time, sector times, current timing lines
- `TimingAppData`: tyre compounds, stint information, tyre age
- `LapCount`: current lap and total laps
- `SessionStatus`: started, finished, aborted, inactive state changes
- `TrackStatus`: yellow, red, SC, VSC, all-clear state
- `RaceControlMessages`: flags, DRS, investigation, penalty, and race-control notes

There is a small sample file at `examples/live_timing_sample.txt`.

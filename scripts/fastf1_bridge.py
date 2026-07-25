from __future__ import annotations

import argparse
import ast
import json
import math
import os
import subprocess
import sys
import threading
from pathlib import Path
from datetime import timedelta
from functools import lru_cache
from typing import Any

import fastf1
import pandas as pd
from fastf1 import exceptions as fastf1_exceptions
from flask import Flask, jsonify, request
from flask_cors import CORS
from fastf1.livetiming.client import SignalRClient
from fastf1.livetiming.data import LiveTimingData


SESSION_KEYS = {
    "Practice 1": "FP1",
    "Practice 2": "FP2",
    "Practice 3": "FP3",
    "Qualifying": "Q",
    "Sprint": "S",
    "Race": "R",
}

TEAM_COLORS = {
    "Mercedes": "27f4d2",
    "Ferrari": "e80020",
    "McLaren": "f47600",
    "Haas F1 Team": "b6babd",
    "Alpine": "00a1e8",
    "Red Bull Racing": "3671c6",
    "Racing Bulls": "6692ff",
    "Williams": "64c4ff",
    "Aston Martin": "229971",
    "Kick Sauber": "52e252",
    "Sauber": "52e252",
}

SESSION_DURATIONS = {
    "Practice 1": timedelta(hours=1),
    "Practice 2": timedelta(hours=1),
    "Practice 3": timedelta(hours=1),
    "Qualifying": timedelta(hours=1, minutes=15),
    "Sprint Qualifying": timedelta(hours=1),
    "Sprint": timedelta(hours=1),
    "Race": timedelta(hours=3),
}
LIVE_PRE_SESSION_BUFFER = timedelta(minutes=10)
LIVE_POST_SESSION_BUFFER = timedelta(minutes=10)


def parse_lap_time(value: Any) -> float | None:
    if value is None:
        return None
    text = str(value)
    try:
        if ":" in text:
            minutes, rest = text.split(":", 1)
            return round(int(minutes) * 60 + float(rest), 3)
        return round(float(text), 3)
    except (TypeError, ValueError):
        return None


def parse_recorded_line(line: str) -> tuple[str, Any, str] | None:
    try:
        category, payload, timestamp = ast.literal_eval(line.strip())
    except (SyntaxError, ValueError):
        return None

    if isinstance(payload, str):
        try:
            payload = json.loads(payload)
        except json.JSONDecodeError:
            pass
    return str(category), payload, str(timestamp)


def merge_live_dict(base: dict[str, Any], update: dict[str, Any]) -> dict[str, Any]:
    for key, value in update.items():
        if isinstance(value, dict) and isinstance(base.get(key), dict):
            merge_live_dict(base[key], value)
        else:
            base[key] = value
    return base


class LiveTimingStore:
    def __init__(self, directory: str, timeout: int):
        self.directory = Path(directory)
        self.timeout = timeout
        self.directory.mkdir(parents=True, exist_ok=True)
        self.session_info: dict[str, Any] | None = None
        self.file: Path | None = None
        self.thread: threading.Thread | None = None
        self.error: str | None = None

    def is_recording(self) -> bool:
        return bool(self.thread and self.thread.is_alive())

    def recording_file_size(self) -> int:
        if not self.file or not self.file.exists():
            return 0
        return self.file.stat().st_size

    def status_payload(self, file: Path) -> dict[str, Any]:
        size = self.recording_file_size()
        auth_hint = None
        if self.is_recording() and size == 0:
            auth_hint = (
                "Waiting for live timing data. If this is the first live run, "
                "complete the FastF1 F1TV authentication prompt in the bridge terminal."
            )
        return {
            "recording": self.is_recording(),
            "recording_file": str(file),
            "recording_file_size": size,
            "data_available": size > 0,
            "auth_hint": auth_hint,
            "error": self.error,
        }

    def set_session(self, info: dict[str, Any]) -> Path:
        self.session_info = info
        filename = f"{info['year']}-r{info['round_number']:02d}-{info['session_code']}.txt"
        self.file = self.directory / filename
        return self.file

    def start(self, info: dict[str, Any]) -> Path:
        filename = self.set_session(info)
        if self.is_recording():
            return filename

        def run_client() -> None:
            try:
                SignalRClient(str(filename), filemode="a", timeout=self.timeout).start()
            except Exception as exc:
                self.error = str(exc)

        self.thread = threading.Thread(target=run_client, daemon=True)
        self.thread.start()
        return filename

    def snapshot(self) -> dict[str, Any]:
        drivers: dict[str, dict[str, Any]] = {}
        tyre_stints: dict[str, dict[str, dict[str, Any]]] = {}
        timing_state: dict[str, dict[str, Any]] = {}
        laps: dict[str, dict[int, dict[str, Any]]] = {}
        latest_lap_count = None

        if not self.file or not self.file.exists():
            return {"drivers": drivers, "laps": [], "stints": [], "lap_count": latest_lap_count}

        with self.file.open() as fobj:
            for line in fobj:
                parsed = parse_recorded_line(line)
                if parsed is None:
                    continue
                category, payload, _timestamp = parsed
                if not isinstance(payload, dict):
                    continue

                if category == "DriverList":
                    for racing_number, data in payload.items():
                        if not isinstance(data, dict):
                            continue
                        previous = drivers.setdefault(
                            str(racing_number),
                            {
                                "driver_number": str(racing_number),
                                "broadcast_name": str(racing_number),
                                "team_name": "",
                                "team_colour": "697386",
                                "tla": str(racing_number),
                                "full_name": "",
                            },
                        )
                        merged = merge_live_dict(previous, data.copy())
                        drivers[str(racing_number)] = {
                            "driver_number": str(racing_number),
                            "broadcast_name": clean_string(merged.get("BroadcastName"), previous.get("broadcast_name", str(racing_number))),
                            "team_name": clean_string(merged.get("TeamName"), previous.get("team_name", "")),
                            "team_colour": clean_string(merged.get("TeamColour"), previous.get("team_colour", "697386")).lstrip("#"),
                            "tla": clean_string(merged.get("Tla"), previous.get("tla", str(racing_number))),
                            "full_name": clean_string(merged.get("FullName"), previous.get("full_name", clean_string(merged.get("BroadcastName"), ""))),
                        }

                elif category == "TimingAppData":
                    for racing_number, line_data in payload.get("Lines", {}).items():
                        stints = line_data.get("Stints", {}) if isinstance(line_data, dict) else {}
                        tyre_stints.setdefault(str(racing_number), {})
                        if isinstance(stints, list):
                            stint_items = enumerate(stints)
                        elif isinstance(stints, dict):
                            stint_items = stints.items()
                        else:
                            stint_items = []
                        for stint_number, stint in stint_items:
                            if not isinstance(stint, dict):
                                continue
                            existing = tyre_stints[str(racing_number)].setdefault(str(stint_number), {})
                            merged_stint = merge_live_dict(existing, stint.copy())
                            lap_number = merged_stint.get("LapNumber")
                            lap_seconds = parse_lap_time(merged_stint.get("LapTime"))
                            if lap_number is not None and lap_seconds is not None:
                                number = int(lap_number)
                                laps.setdefault(str(racing_number), {})[number] = {
                                    "lap_number": number,
                                    "lap_duration": lap_seconds,
                                    "driver_number": str(racing_number),
                                }

                elif category == "TimingData":
                    for racing_number, line_data in payload.get("Lines", {}).items():
                        if not isinstance(line_data, dict):
                            continue
                        merged_line = merge_live_dict(timing_state.setdefault(str(racing_number), {}), line_data.copy())
                        lap_number = merged_line.get("NumberOfLaps")
                        lap_time = merged_line.get("LastLapTime", {})
                        if isinstance(lap_time, dict):
                            lap_time = lap_time.get("Value")
                        lap_seconds = parse_lap_time(lap_time)
                        if lap_number is None or lap_seconds is None:
                            continue
                        number = int(lap_number)
                        laps.setdefault(str(racing_number), {})[number] = {
                            "lap_number": number,
                            "lap_duration": lap_seconds,
                            "driver_number": str(racing_number),
                        }

                elif category == "LapCount":
                    latest_lap_count = payload

        lap_rows = []
        stint_rows = []
        for racing_number, driver_laps in laps.items():
            stints = tyre_stints.get(racing_number, {})
            sorted_stints = sorted(stints.items(), key=lambda item: int(item[0]) if str(item[0]).isdigit() else 0)
            normalized_stints = []
            next_lap_start = 1
            for _stint_number, stint in sorted_stints:
                total_laps = int(stint.get("TotalLaps") or 0)
                if total_laps <= 0:
                    continue
                lap_start = next_lap_start
                lap_end = lap_start + total_laps - 1
                next_lap_start = lap_end + 1
                normalized_stints.append(
                    {
                        "compound": clean_string(stint.get("Compound"), "UNKNOWN").upper(),
                        "lap_start": lap_start,
                        "lap_end": lap_end,
                    }
                )
            if driver_laps:
                latest_driver_lap = max(driver_laps)
                if normalized_stints and normalized_stints[-1]["lap_end"] < latest_driver_lap:
                    normalized_stints[-1]["lap_end"] = latest_driver_lap
                elif not normalized_stints:
                    normalized_stints.append(
                        {
                            "compound": "UNKNOWN",
                            "lap_start": 1,
                            "lap_end": latest_driver_lap,
                        }
                    )

            for lap in driver_laps.values():
                compound = ""
                tyre_life = 0
                for stint in normalized_stints:
                    if stint["lap_start"] <= lap["lap_number"] <= stint["lap_end"]:
                        compound = stint["compound"]
                        tyre_life = lap["lap_number"] - stint["lap_start"] + 1
                lap_rows.append({**lap, "compound": compound, "tyre_life": tyre_life})

            for stint in normalized_stints:
                stint_rows.append(
                    {
                        "driver_number": racing_number,
                        "compound": stint["compound"],
                        "lap_start": stint["lap_start"],
                        "lap_end": stint["lap_end"],
                    }
                )

        return {
            "drivers": drivers,
            "laps": sorted(lap_rows, key=lambda item: (item["driver_number"], item["lap_number"])),
            "stints": stint_rows,
            "lap_count": latest_lap_count,
        }


def clean_string(value: Any, fallback: str = "") -> str:
    if value is None or pd.isna(value):
        return fallback
    return str(value)


def seconds(value: Any) -> float | None:
    if value is None or pd.isna(value):
        return None
    if hasattr(value, "total_seconds"):
        number = float(value.total_seconds())
    else:
        try:
            number = float(value)
        except (TypeError, ValueError):
            return None
    if math.isnan(number):
        return None
    return round(number, 3)


def encode_session_key(year: int, round_number: int, session_name: str) -> str:
    return f"{year}:{round_number}:{SESSION_KEYS.get(session_name, session_name)}"


def decode_session_key(value: str, default_year: int, default_gp: str, default_session: str) -> tuple[int, int | str, str]:
    try:
        year, gp, session = value.split(":", 2)
        return int(year), int(gp), session
    except ValueError:
        return default_year, default_gp, value or default_session


def make_app(
    default_year: int,
    default_gp: str,
    default_session: str,
    cache_dir: str,
    force_refresh: bool,
    livedata_files: tuple[str, ...] = (),
) -> Flask:
    os.makedirs(cache_dir, exist_ok=True)
    fastf1.Cache.enable_cache(cache_dir, force_renew=force_refresh)
    fastf1.set_log_level("WARNING")

    app = Flask(__name__)
    CORS(app)
    live_store = LiveTimingStore(os.getenv("FASTF1_LIVE_DIR", "live-recordings"), int(os.getenv("FASTF1_LIVE_TIMEOUT", "120")))

    @lru_cache(maxsize=16)
    def schedule(year: int):
        return fastf1.get_event_schedule(year, include_testing=False)

    @lru_cache(maxsize=16)
    def load_session(year: int, gp: int | str, session_name: str):
        session = fastf1.get_session(year, gp, session_name)
        livedata = LiveTimingData(*livedata_files) if livedata_files else None
        session.load(telemetry=False, weather=False, messages=False, livedata=livedata)
        return session

    @lru_cache(maxsize=8)
    def load_telemetry_session(year: int, gp: int | str, session_name: str):
        session = fastf1.get_session(year, gp, session_name)
        session.load(telemetry=True, weather=False, messages=False)
        return session

    def session_from_key(session_key: str):
        year, gp, session_name = decode_session_key(session_key, default_year, default_gp, default_session)
        return load_session(year, gp, session_name)

    def telemetry_session_from_key(session_key: str):
        year, gp, session_name = decode_session_key(session_key, default_year, default_gp, default_session)
        return load_telemetry_session(year, gp, session_name)

    def infer_live_session(now: pd.Timestamp | None = None) -> dict[str, Any] | None:
        now = now or pd.Timestamp.now(tz="UTC").tz_localize(None)
        for year in {now.year - 1, now.year, now.year + 1}:
            try:
                events = schedule(year)
            except Exception:
                continue
            for _, event in events.iterrows():
                round_number = int(event.get("RoundNumber", 0) or 0)
                if round_number == 0:
                    continue
                for index in range(1, 6):
                    session_name = clean_string(event.get(f"Session{index}"))
                    session_start = event.get(f"Session{index}DateUtc")
                    if not session_name or session_start is None or pd.isna(session_start):
                        continue
                    start = pd.Timestamp(session_start).tz_localize(None)
                    duration = SESSION_DURATIONS.get(session_name, timedelta(hours=2))
                    window_start = start - LIVE_PRE_SESSION_BUFFER
                    window_end = start + duration + LIVE_POST_SESSION_BUFFER
                    if window_start <= now <= window_end:
                        session_code = SESSION_KEYS.get(session_name, session_name)
                        return {
                            "live": True,
                            "year": int(year),
                            "round_number": round_number,
                            "country_name": clean_string(event.get("Country"), ""),
                            "meeting_name": clean_string(event.get("EventName"), ""),
                            "session_name": session_name,
                            "session_code": session_code,
                            "session_key": f"live:{year}:{round_number}:{session_code}",
                            "date_start": start.isoformat() + "Z",
                            "poll_interval_ms": 5000,
                        }
        return None

    def is_live_session_key(session_key: str) -> bool:
        return session_key.startswith("live:")

    def live_snapshot_for_request() -> dict[str, Any]:
        return live_store.snapshot()

    def loaded_laps_or_none(session):
        try:
            return session.laps
        except fastf1_exceptions.DataNotLoadedError:
            return None

    def session_driver_meta(session) -> dict[str, dict[str, Any]]:
        meta: dict[str, dict[str, Any]] = {}
        results = getattr(session, "results", None)
        if results is not None and not results.empty:
            for _, row in results.iterrows():
                code = clean_string(row.get("Abbreviation"), clean_string(row.get("BroadcastName"), "")[:3])
                team = clean_string(row.get("TeamName"), "")
                driver_number = clean_string(row.get("DriverNumber"), code)
                broadcast = clean_string(row.get("BroadcastName"), code)
                full_name = clean_string(row.get("FullName"), broadcast)
                meta[driver_number] = {
                    "abbreviation": code,
                    "broadcast_name": broadcast,
                    "full_name": full_name,
                    "team_name": team,
                    "team_colour": TEAM_COLORS.get(team, "697386"),
                }
                meta[code] = meta[driver_number]
        return meta

    def driver_number_for_row(row: pd.Series) -> str:
        number = clean_string(row.get("DriverNumber"))
        if number:
            return number
        return clean_string(row.get("Driver"), "UNK")

    @app.get("/health")
    def health():
        return jsonify({"ok": True, "source": "fastf1"})

    @app.get("/v1/live/status")
    def live_status():
        info = infer_live_session()
        if info is None:
            return jsonify({"live": False, "message": "No live session at the moment"}), 404
        file = live_store.set_session(info)
        return jsonify(
            {
                **info,
                **live_store.status_payload(file),
            }
        )

    @app.post("/v1/live/start")
    def live_start():
        info = infer_live_session()
        if info is None:
            return jsonify({"live": False, "message": "No live session at the moment"}), 404
        file = live_store.start(info)
        return jsonify(
            {
                **info,
                **live_store.status_payload(file),
            }
        )

    @app.get("/v1/meetings")
    def meetings():
        year = int(request.args.get("year", default_year))
        events = schedule(year)
        payload = []
        for _, row in events.iterrows():
            round_number = int(row.get("RoundNumber", 0) or 0)
            if round_number == 0:
                continue
            start = row.get("EventDate")
            payload.append(
                {
                    "meeting_key": f"{year}:{round_number}",
                    "country_name": clean_string(row.get("Country"), clean_string(row.get("Location"), "")),
                    "meeting_name": clean_string(row.get("EventName"), ""),
                    "date_start": "" if pd.isna(start) else pd.Timestamp(start).isoformat(),
                    "date_end": "" if pd.isna(start) else (pd.Timestamp(start) + pd.Timedelta(4, "D")).isoformat(),
                    "round_number": round_number,
                }
            )
        return jsonify(payload)

    @app.get("/v1/sessions")
    def sessions():
        year = int(request.args.get("year", default_year))
        country = request.args.get("country_name", "")
        events = schedule(year)
        event = events[events["Country"].astype(str).str.lower() == country.lower()]
        if event.empty:
            event = events[events["EventName"].astype(str).str.lower().str.contains(country.lower(), regex=False)]
        if event.empty:
            return jsonify([])

        row = event.iloc[0]
        round_number = int(row.get("RoundNumber", 0) or 0)
        payload = []
        for index in range(1, 6):
            session_name = clean_string(row.get(f"Session{index}"))
            date_value = row.get(f"Session{index}Date")
            if date_value is None or pd.isna(date_value):
                continue
            payload.append(
                {
                    "session_key": encode_session_key(year, round_number, session_name),
                    "session_name": session_name,
                    "date_start": pd.Timestamp(date_value).isoformat(),
                }
            )
        return jsonify(payload)

    @app.get("/v1/drivers")
    def drivers():
        session_key = request.args.get("session_key", "")
        if is_live_session_key(session_key):
            snapshot = live_snapshot_for_request()
            return jsonify(
                [
                    {
                        "driver_number": driver["driver_number"],
                        "broadcast_name": driver["broadcast_name"],
                        "team_name": driver["team_name"],
                        "team_colour": driver["team_colour"],
                    }
                    for driver in snapshot["drivers"].values()
                ]
            )

        session = session_from_key(session_key)
        meta = session_driver_meta(session)
        if meta:
            unique = {}
            for driver in meta.values():
                unique[driver["abbreviation"]] = driver
            return jsonify(
                [
                    {
                        "driver_number": value["abbreviation"],
                        "broadcast_name": value["broadcast_name"],
                        "team_name": value["team_name"],
                        "team_colour": value["team_colour"],
                    }
                    for value in unique.values()
                ]
            )

        laps = loaded_laps_or_none(session)
        if laps is None:
            return jsonify([]), 202

        codes = sorted(laps["Driver"].dropna().unique().tolist())
        return jsonify(
            [
                {
                    "driver_number": code,
                    "broadcast_name": code,
                    "team_name": "",
                    "team_colour": "697386",
                }
                for code in codes
            ]
        )

    @app.get("/v1/laps")
    def laps():
        session_key = request.args.get("session_key", "")
        driver_number = request.args.get("driver_number", "")
        if is_live_session_key(session_key):
            snapshot = live_snapshot_for_request()
            return jsonify([lap for lap in snapshot["laps"] if lap["driver_number"] == driver_number])

        session = session_from_key(session_key)
        meta = session_driver_meta(session)
        code = meta.get(driver_number, {}).get("abbreviation", driver_number)

        rows = loaded_laps_or_none(session)
        if rows is None:
            return jsonify([]), 202
        rows = rows[rows["Driver"].astype(str) == code].sort_values("LapNumber")
        payload = []
        for _, row in rows.iterrows():
            lap_number = int(row.get("LapNumber", 0) or 0)
            payload.append(
                {
                    "lap_number": lap_number,
                    "lap_duration": seconds(row.get("LapTime")),
                    "driver_number": driver_number,
                    "compound": clean_string(row.get("Compound"), "").upper(),
                    "tyre_life": int(row.get("TyreLife", 0) or 0),
                }
            )
        return jsonify(payload)

    @app.get("/v1/stints")
    def stints():
        session_key = request.args.get("session_key", "")
        driver_number = request.args.get("driver_number", "")
        if is_live_session_key(session_key):
            snapshot = live_snapshot_for_request()
            return jsonify([stint for stint in snapshot["stints"] if stint["driver_number"] == driver_number])

        session = session_from_key(session_key)
        meta = session_driver_meta(session)
        code = meta.get(driver_number, {}).get("abbreviation", driver_number)

        rows = loaded_laps_or_none(session)
        if rows is None:
            return jsonify([]), 202
        rows = rows[rows["Driver"].astype(str) == code].sort_values("LapNumber")
        payload = []
        current = None
        previous_life = None

        for _, row in rows.iterrows():
            lap_number = int(row.get("LapNumber", 0) or 0)
            compound = clean_string(row.get("Compound"), "UNKNOWN").upper()
            tyre_life = int(row.get("TyreLife", 0) or 0)
            starts_new = (
                current is None
                or current["compound"] != compound
                or (previous_life is not None and tyre_life < previous_life)
            )
            if starts_new:
                if current is not None:
                    payload.append(current)
                current = {"compound": compound, "lap_start": lap_number, "lap_end": lap_number}
            else:
                current["lap_end"] = lap_number
            previous_life = tyre_life

        if current is not None:
            payload.append(current)
        return jsonify(payload)

    @app.get("/v1/telemetry")
    def telemetry():
        session_key = request.args.get("session_key", "")
        driver_number = request.args.get("driver_number", "")
        lap_number = int(request.args.get("lap_number", "0") or 0)

        if is_live_session_key(session_key):
            return jsonify({"message": "Telemetry traces are unavailable for live-recorded sessions until FastF1 can process full car data."}), 202

        session = telemetry_session_from_key(session_key)
        meta = session_driver_meta(session)
        code = meta.get(driver_number, {}).get("abbreviation", driver_number)

        rows = loaded_laps_or_none(session)
        if rows is None:
            return jsonify({"message": "Telemetry data is not loaded yet."}), 202

        matches = rows[(rows["Driver"].astype(str) == code) & (rows["LapNumber"].astype(int) == lap_number)]
        if matches.empty:
            return jsonify({"message": f"No lap {lap_number} found for {driver_number}."}), 404

        lap = matches.iloc[0]
        telemetry_rows = lap.get_telemetry().add_distance()
        if telemetry_rows.empty:
            return jsonify({"message": f"No telemetry data found for {driver_number} lap {lap_number}."}), 404

        points = []
        for _, row in telemetry_rows.iterrows():
            distance = row.get("Distance")
            speed = row.get("Speed")
            x_position = row.get("X")
            y_position = row.get("Y")
            if pd.isna(distance) or pd.isna(speed):
                continue
            point = {"distance": round(float(distance), 3), "speed": float(speed)}
            if x_position is not None and y_position is not None and not pd.isna(x_position) and not pd.isna(y_position):
                point["x"] = float(x_position)
                point["y"] = float(y_position)
            points.append(point)

        return jsonify(
            {
                "driver_number": driver_number,
                "driver": code,
                "lap_number": lap_number,
                "lap_time": seconds(lap.get("LapTime")),
                "team_name": clean_string(lap.get("Team"), ""),
                "compound": clean_string(lap.get("Compound"), "").upper(),
                "points": points,
            }
        )

    @app.get("/v1/corners")
    def corners():
        session_key = request.args.get("session_key", "")
        if is_live_session_key(session_key):
            return jsonify([])

        session = telemetry_session_from_key(session_key)
        try:
            circuit_info = session.get_circuit_info()
        except Exception:
            return jsonify([])

        payload = []
        for _, corner in circuit_info.corners.iterrows():
            distance = corner.get("Distance")
            number = corner.get("Number")
            if pd.isna(distance) or pd.isna(number):
                continue
            payload.append(
                {
                    "distance": round(float(distance), 3),
                    "number": str(int(number)),
                    "letter": clean_string(corner.get("Letter"), ""),
                }
            )
        return jsonify(payload)

    return app


def main() -> None:
    parser = argparse.ArgumentParser(description="Serve FastF1 data using OpenF1-like endpoints for stint-data.")
    parser.add_argument("--year", type=int, default=int(os.getenv("FASTF1_YEAR", "2026")))
    parser.add_argument("--gp", default=os.getenv("FASTF1_GP", "Hungary"))
    parser.add_argument("--session", default=os.getenv("FASTF1_SESSION", "R"))
    parser.add_argument("--cache", default=os.getenv("FASTF1_CACHE", ".fastf1-cache"))
    parser.add_argument("--force-refresh", action="store_true")
    parser.add_argument("--livedata", nargs="*", default=(), help="One or more FastF1 live timing recording files to load.")
    parser.add_argument("--auth-status", action="store_true", help="Show FastF1/F1TV authentication status and exit.")
    parser.add_argument("--authenticate-f1tv", action="store_true", help="Start FastF1's F1TV browser authentication flow and exit.")
    parser.add_argument("--port", type=int, default=int(os.getenv("PORT", "5050")))
    args = parser.parse_args()

    if args.auth_status or args.authenticate_f1tv:
        command = [sys.executable, "-m", "fastf1", "auth", "f1tv"]
        command.append("--authenticate" if args.authenticate_f1tv else "--status")
        raise SystemExit(subprocess.call(command))

    app = make_app(args.year, args.gp, args.session, args.cache, args.force_refresh, tuple(args.livedata))
    app.run(host="127.0.0.1", port=args.port)


if __name__ == "__main__":
    main()

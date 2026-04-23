"""
Fetch water parameter readings from a Tuya smart sensor and write
Fish_Tanks/water-params.json for the website to display.

Required environment variables:
    TUYA_ACCESS_ID   - Tuya Cloud Project Access ID (Client ID)
    TUYA_ACCESS_KEY  - Tuya Cloud Project Access Key (Client Secret)
    TUYA_DEVICE_ID   - Device ID from Tuya app or Cloud Project device list
    TUYA_REGION      - API region: us | eu | cn | in  (default: us)

Tuya API docs: https://developer.tuya.com/en/docs/cloud
"""

import hashlib
import hmac
import json
import os
import sys
import time
from datetime import datetime, timezone

import requests

ACCESS_ID  = os.environ["TUYA_ACCESS_ID"]
ACCESS_KEY = os.environ["TUYA_ACCESS_KEY"]
DEVICE_ID  = os.environ["TUYA_DEVICE_ID"]
REGION     = os.environ.get("TUYA_REGION", "us")

BASE_URL   = f"https://openapi.tuya{REGION}.com"


# ---------------------------------------------------------------------------
# Tuya HMAC-SHA256 signing
# ---------------------------------------------------------------------------

def _sign(client_id: str, secret: str, t: int, access_token: str, path: str, method: str = "GET") -> str:
    """Return the uppercase hex HMAC-SHA256 signature required by Tuya OpenAPI."""
    content_hash  = hashlib.sha256(b"").hexdigest()
    string_to_sign = f"{method}\n{content_hash}\n\n{path}"
    sign_str = client_id + access_token + str(t) + string_to_sign
    return hmac.new(secret.encode(), sign_str.encode(), hashlib.sha256).hexdigest().upper()


def _headers(path: str, access_token: str = "") -> dict:
    t = int(time.time() * 1000)
    return {
        "client_id":    ACCESS_ID,
        "access_token": access_token,
        "sign":         _sign(ACCESS_ID, ACCESS_KEY, t, access_token, path),
        "t":            str(t),
        "sign_method":  "HMAC-SHA256",
    }


# ---------------------------------------------------------------------------
# API calls
# ---------------------------------------------------------------------------

def get_token() -> str:
    path = "/v1.0/token?grant_type=1"
    resp = requests.get(BASE_URL + path, headers=_headers(path), timeout=15)
    resp.raise_for_status()
    data = resp.json()
    if not data.get("success"):
        raise RuntimeError(f"Token request failed: {data}")
    return data["result"]["access_token"]


def get_device_status(access_token: str) -> list:
    path = f"/v1.0/devices/{DEVICE_ID}/status"
    resp = requests.get(BASE_URL + path, headers=_headers(path, access_token), timeout=15)
    resp.raise_for_status()
    data = resp.json()
    if not data.get("success"):
        raise RuntimeError(f"Device status request failed: {data}")
    return data["result"]


def get_dp_latest(access_token: str) -> list:
    """Fetch latest DP values for all data points on the device.

    Unlike /status (which only returns standard-mapped DPs), this endpoint
    returns every DP the device has ever reported, including non-standard ones
    like pH that aren't in the standard instruction set.
    Returns a list of {"code": ..., "value": ...} dicts.
    """
    path = f"/v1.0/devices/{DEVICE_ID}/dp-latest"
    resp = requests.get(BASE_URL + path, headers=_headers(path, access_token), timeout=15)
    resp.raise_for_status()
    data = resp.json()
    if not data.get("success"):
        print(f"Warning: dp-latest request failed: {data}")
        return []
    result = data.get("result", [])
    # Response shape: {"result": [{"code": ..., "value": ..., "t": ...}, ...]}
    return result if isinstance(result, list) else []


# ---------------------------------------------------------------------------
# Parameter mapping
#
# Tuya sensor property codes vary by device model. The table below covers
# the most common water-quality sensor codes. On first run the script prints
# the full raw status so you can identify any codes not listed here and add
# them. Just add a new entry: "tuya_code": ("param_name", lambda v: v)
# ---------------------------------------------------------------------------

PARAM_CODES = {
    # Temperature — Tuya typically sends °C × 10
    "temp_current":   ("temperature_f", lambda v: round(v / 10 * 9 / 5 + 32, 1)),
    "temp_value":     ("temperature_f", lambda v: round(v / 10 * 9 / 5 + 32, 1)),
    "va_temperature": ("temperature_f", lambda v: round(v / 10 * 9 / 5 + 32, 1)),
    # pH — Tuya typically sends pH × 10
    "ph_value":       ("ph",            lambda v: round(v / 100, 2)),
    "va_ph":          ("ph",            lambda v: round(v / 100, 2)),
    "ph":             ("ph",            lambda v: round(v / 100, 2)),
    "ph_current":     ("ph",            lambda v: round(v / 100, 2)),
    # TDS — ppm, direct value
    "tds_in":         ("tds",           lambda v: int(v)),
    "tds":            ("tds",           lambda v: int(v)),
    "va_tds":         ("tds",           lambda v: int(v)),
}

# Healthy ranges for a tropical freshwater community tank.
# Adjust min/max to match your fish's needs.
RANGES = {
    "temperature_f": {"min": 74, "max": 82},
    "ph":            {"min": 6.8, "max": 7.6},
    "tds":           {"min": 0,   "max": 300},
}


def parse_status(status_list: list) -> dict:
    print("Raw device status:")
    print(json.dumps(status_list, indent=2))

    params = {}
    for item in status_list:
        code  = item.get("code", "")
        value = item.get("value")
        if code in PARAM_CODES:
            param_name, convert = PARAM_CODES[code]
            if param_name not in params:   # first matching code wins
                try:
                    params[param_name] = convert(value)
                except Exception as e:
                    print(f"Warning: could not convert code '{code}' value {value!r}: {e}")

    return params


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    out_path    = "Fish_Tanks/water-params.json"
    config_path = "Fish_Tanks/probe-config.json"

    with open(config_path) as f:
        active_tank = json.load(f)["active_tank"]
    print(f"Probe is in: {active_tank}")

    # Load existing JSON to preserve previous readings and migrate old flat format.
    all_readings = {}
    try:
        with open(out_path) as f:
            existing = json.load(f)
        all_readings = existing.get("readings", {})
        if not all_readings and "params" in existing:
            # Migrate from old flat structure
            old_tank = existing.get("tank", active_tank)
            all_readings[old_tank] = {
                "updated": existing["updated"],
                "params":  existing["params"],
                "ranges":  existing["ranges"],
            }
            print(f"Migrated old flat entry for '{old_tank}' into readings.")
    except (FileNotFoundError, json.JSONDecodeError):
        pass

    # Preserve params from the active tank's last run (sensor may not report all codes each time).
    previous_params = all_readings.get(active_tank, {}).get("params", {})

    print(f"Connecting to Tuya OpenAPI ({BASE_URL})...")
    token = get_token()
    print("Token acquired.")

    print(f"Fetching status for device {DEVICE_ID}...")
    status = get_device_status(token)

    new_params = parse_status(status)

    if not new_params:
        print(
            "\nERROR: No recognized parameter codes found in the device status.\n"
            "Check the raw output above, identify the relevant codes, and add\n"
            "them to the PARAM_CODES table in this script.",
            file=sys.stderr,
        )
        sys.exit(1)

    # If any expected params are missing from the live status, try the logs API.
    expected = {"temperature_f", "ph", "tds"}
    missing = expected - new_params.keys()
    if missing:
        print(f"\nNote: {sorted(missing)} not in live status — checking device logs...")
        dp_latest = get_dp_latest(token)
        print(f"DP-latest: {json.dumps(dp_latest, indent=2)}")
        dp_params = parse_status(dp_latest)
        for k, v in dp_params.items():
            if k not in new_params:
                print(f"  Filled '{k}' from dp-latest: {v}")
                new_params[k] = v

    # Merge: start with previous readings, then overlay whatever the sensor reported now.
    params = {**previous_params, **new_params}

    # Update only the active tank's entry; all other tank entries stay untouched.
    all_readings[active_tank] = {
        "updated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "params":  params,
        "ranges":  RANGES,
    }

    output = {
        "active_tank": active_tank,
        "readings":    all_readings,
    }

    with open(out_path, "w") as f:
        json.dump(output, f, indent=2)

    print(f"\nWrote {out_path}:")
    print(json.dumps(output, indent=2))


if __name__ == "__main__":
    main()

"""Container healthcheck: web server up AND a recent successful poll."""
import datetime as dt
import json
import os
import sys
import urllib.request

PORT = os.environ.get("WEB_PORT", "8080")
MAX_AGE = float(os.environ.get("HEALTH_MAX_POLL_AGE", "120"))


def main() -> int:
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{PORT}/healthz", timeout=4) as resp:
            data = json.loads(resp.read())
    except Exception as exc:  # noqa: BLE001
        print(f"health: web unreachable: {exc}")
        return 1

    last_poll = data.get("last_poll_at")
    if not last_poll:
        # No poll yet (cold start). start_period covers this window.
        print("health: no poll yet")
        return 0
    try:
        ts = dt.datetime.fromisoformat(last_poll.replace("Z", "+00:00"))
        age = (dt.datetime.now(dt.UTC) - ts).total_seconds()
    except ValueError:
        return 0
    if age > MAX_AGE:
        print(f"health: stale poll ({age:.0f}s old)")
        return 1
    print(f"health: ok (poll {age:.0f}s old)")
    return 0


if __name__ == "__main__":
    sys.exit(main())

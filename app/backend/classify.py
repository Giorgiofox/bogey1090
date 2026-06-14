"""Aircraft classification: military scoring + traffic class + HEMS detection.

Uses the local tar1090 aircraft DB fields (`r`, `t`, `desc`, `dbFlags`) when present
(TAR1090_ENABLE_AC_DB=true) so most classification needs no external lookups.
"""
import re
from dataclasses import dataclass

from . import config

# dbFlags bitmask from readsb aircraft DB.
DBFLAG_MILITARY = 0x1
DBFLAG_INTERESTING = 0x2
DBFLAG_PIA = 0x4
DBFLAG_LADD = 0x8

# Airline callsign: 3 letters + 1..4 digits/alphanumerics (e.g. RYR1234, AZA56G).
_AIRLINE_CALLSIGN = re.compile(r"^[A-Z]{3}\d[A-Z0-9]*$")


@dataclass
class Meta:
    reg: str | None
    ac_type: str | None
    ac_desc: str | None
    db_flags: int | None
    military_score: int
    military_reasons: str
    traffic_class: str
    mlat: int


def clean_flight(value) -> str | None:
    if not value:
        return None
    value = str(value).strip().upper()
    return value or None


def as_text(value) -> str | None:
    return str(value) if value is not None else None


def military_score(aircraft: dict) -> tuple[int, list[str]]:
    score = 0
    reasons: list[str] = []
    flight = clean_flight(aircraft.get("flight")) or ""
    category = aircraft.get("category") or ""
    squawk = str(aircraft.get("squawk") or "")
    hexid = str(aircraft.get("hex") or "").lower()
    db_flags = int(aircraft.get("dbFlags") or 0)

    if db_flags & DBFLAG_MILITARY:
        score += 90
        reasons.append("dbflag:military")
    if any(flight.startswith(prefix) for prefix in config.MILITARY_PREFIXES):
        score += 80
        reasons.append(f"callsign:{flight}")
    if squawk in {"7001", "7002", "7003", "7400", "7500", "7600", "7700"}:
        score += 25
        reasons.append(f"squawk:{squawk}")
    if category in {"A6", "A7", "B6", "B7"}:
        score += 10
        reasons.append(f"category:{category}")
    if not flight and aircraft.get("lat") is not None and aircraft.get("lon") is not None:
        score += 5
        reasons.append("no_callsign_with_position")
    if hexid.startswith(("3f", "43c", "43e", "ae")):
        score += 35
        reasons.append(f"icao_prefix:{hexid[:3]}")

    return min(score, 100), reasons


def _is_drone(aircraft: dict, ac_type: str | None) -> bool:
    if ac_type:  # type code wins over the (noisy) emitter category
        return ac_type.upper() in config.UAS_TYPES
    return aircraft.get("category") == "B6"  # UAV, only when type unknown


def _is_rotorcraft(aircraft: dict, ac_type: str | None) -> bool:
    # The ICAO type code is authoritative. ADS-B emitter category is noisy (airliners
    # sometimes broadcast A7), so only trust category A7 when the type is unknown.
    if ac_type:
        return ac_type.upper() in config.HELI_TYPES
    return aircraft.get("category") == "A7"


def _is_hems(flight: str, ac_desc: str | None, ac_type: str | None) -> bool:
    haystack = " ".join(filter(None, [flight, ac_desc or "", ac_type or ""])).upper()
    return any(marker in haystack for marker in config.HEMS_MARKERS)


def _looks_like_airline(flight: str) -> bool:
    return bool(_AIRLINE_CALLSIGN.match(flight))


def traffic_class(aircraft: dict, score: int, ac_type: str | None, ac_desc: str | None) -> str:
    """Assign a traffic class. Priority: military > emergency > hems > helicopter
    > airline > ga. Airline detection is heuristic here and refined by enrichment."""
    flight = clean_flight(aircraft.get("flight")) or ""
    squawk = str(aircraft.get("squawk") or "")
    db_flags = int(aircraft.get("dbFlags") or 0)

    if db_flags & DBFLAG_MILITARY or score >= 50:
        return "military"
    if squawk in config.EMERGENCY_SQUAWKS:
        return "emergency"
    if _is_drone(aircraft, ac_type):
        return "drone"
    rotor = _is_rotorcraft(aircraft, ac_type)
    if rotor and _is_hems(flight, ac_desc, ac_type):
        return "hems"
    if rotor:
        return "helicopter"
    if _looks_like_airline(flight):
        return "airline"
    # Large/heavy fixed-wing (ADS-B category A3/A4/A5) is virtually always commercial,
    # even when the callsign is momentarily missing — keep it out of non-airline.
    if aircraft.get("category") in {"A3", "A4", "A5"}:
        return "airline"
    return "ga"


def classify(aircraft: dict) -> Meta:
    reg = as_text(aircraft.get("r"))
    ac_type = as_text(aircraft.get("t"))
    ac_desc = as_text(aircraft.get("desc"))
    db_flags = int(aircraft["dbFlags"]) if aircraft.get("dbFlags") is not None else None
    score, reasons = military_score(aircraft)
    klass = traffic_class(aircraft, score, ac_type, ac_desc)
    # MLAT: position derived from multilateration rather than ADS-B.
    mlat = 1 if (aircraft.get("mlat") or aircraft.get("type") == "mlat") else 0
    return Meta(
        reg=reg,
        ac_type=ac_type,
        ac_desc=ac_desc,
        db_flags=db_flags,
        military_score=score,
        military_reasons=",".join(reasons),
        traffic_class=klass,
        mlat=mlat,
    )

"""Runtime configuration loaded from environment variables."""
import os


def _csv(name: str, default: str) -> tuple[str, ...]:
    raw = os.environ.get(name, default)
    return tuple(p.strip().upper() for p in raw.split(",") if p.strip())


# Data source (tar1090 aircraft.json)
SOURCE_URL = os.environ.get("ADSB_SOURCE_URL", "http://tar1090/data/aircraft.json")
POLL_SECONDS = float(os.environ.get("POLL_SECONDS", "5"))
SAMPLE_MIN_SECONDS = int(os.environ.get("SAMPLE_MIN_SECONDS", "60"))
REQUEST_TIMEOUT = float(os.environ.get("REQUEST_TIMEOUT", "4"))

# Storage
DB_PATH = os.environ.get("DB_PATH", "/data/adsb.sqlite")

# Web server
WEB_BIND = os.environ.get("WEB_BIND", "0.0.0.0")
WEB_PORT = int(os.environ.get("WEB_PORT", "8080"))

# Receiver (for the map)
RECEIVER_NAME = os.environ.get("RECEIVER_NAME", "ADS-B")
RECEIVER_LAT = float(os.environ.get("RECEIVER_LAT", "0") or 0)
RECEIVER_LON = float(os.environ.get("RECEIVER_LON", "0") or 0)

# Enrichment
ENRICH_ENABLED = os.environ.get("ENRICH_ENABLED", "true").lower() not in {"0", "false", "no"}
# planespotters requires a descriptive User-Agent with a contact URL/email.
USER_AGENT = os.environ.get(
    "USER_AGENT", "Bogey1090/2.0 (+https://github.com/Giorgiofox/bogey1090)"
)
ENRICH_TIMEOUT = float(os.environ.get("ENRICH_TIMEOUT", "6"))
ENRICH_TTL_DAYS = int(os.environ.get("ENRICH_TTL_DAYS", "30"))
ENRICH_NOT_FOUND_TTL_DAYS = int(os.environ.get("ENRICH_NOT_FOUND_TTL_DAYS", "7"))
ADSBDB_BASE = os.environ.get("ADSBDB_BASE", "https://api.adsbdb.com/v0")
HEXDB_BASE = os.environ.get("HEXDB_BASE", "https://hexdb.io/api/v1")
PLANESPOTTERS_BASE = os.environ.get("PLANESPOTTERS_BASE", "https://api.planespotters.net/pub/photos")
AIRPORTDATA_BASE = os.environ.get("AIRPORTDATA_BASE", "https://airport-data.com/api")

# Classification
MILITARY_PREFIXES = _csv(
    "MILITARY_CALLSIGN_PREFIXES",
    "IAM,ITAF,AMI,MMF,NATO,RRR,RCH,REACH,GAF,FAF,BAF,NAF,DAF,CFC,CNV,SHF,"
    "ASCOT,DUKE,RAFAIR,VALOR,TIGER,HAWK,VIPER",
)
HEMS_MARKERS = _csv(
    "HEMS_MARKERS",
    "ELILOMBARDA,BABCOCK,HEMS,AMBULANCE,AMBULANZA,ELISOCCORSO,SOCCORSO,"
    "118,REGA,LIFEGUARD,MEDEVAC,MEDICAL,INAER,ELIFRIULIA,AIRGREEN,ELITELLINA",
)
# ICAO type designators that are rotorcraft (extend as needed).
HELI_TYPES = _csv(
    "HELI_TYPES",
    "EC35,EC45,EC30,EC20,EC55,H145,H135,H125,H130,A139,AW39,AW109,AW169,AW189,"
    "B429,B407,B412,B505,B206,B212,B222,R44,R66,S76,S92,A109,A119,NH90,UH60,"
    "CH47,EH10,AW101,A189,A169,A109",
)
EMERGENCY_SQUAWKS = {"7500", "7600", "7700"}
# Known UAS/drone ICAO type designators (the strongest signal is ADS-B category B6).
UAS_TYPES = _csv(
    "UAS_TYPES",
    "RQ4,RQ4A,RQ4B,GHWK,MQ9,MQ9B,MQ1,MQ1C,MQ4,RQ7,RQ20,HERN,HER2,ANKA,"
    "TB2,AKCI,WACP,WK450,GLOB,REAP,PRED,UAV",
)

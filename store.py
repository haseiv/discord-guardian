import json
import os
from pathlib import Path

DEFAULT_PATH = "/app/data/state.json" if Path("/app/data").is_dir() else "data/state.json"
PATH = Path(os.getenv("DATA_FILE", DEFAULT_PATH))
state = {"guilds": {}, "tickets": {}, "rooms": {}}
if PATH.exists():
    state.update(json.loads(PATH.read_text(encoding="utf-8")))


def save():
    PATH.parent.mkdir(parents=True, exist_ok=True)
    temp = PATH.with_suffix(".tmp")
    temp.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(temp, PATH)


def config(guild_id):
    key = str(guild_id)
    if key not in state["guilds"]:
        state["guilds"][key] = {
            "trustedIds": [], "security": {
                "enabled": True, "joinLimit": 8, "joinWindowSeconds": 20,
                "raidDurationMinutes": 10, "minAccountAgeDays": 0,
                "auditLimit": 3, "auditWindowSeconds": 30, "sanction": "ban",
                "spamLimit": 6, "spamWindowSeconds": 8, "spamTimeoutMinutes": 10,
            }, "tickets": {}, "rooms": {"defaultLimit": 0},
        }
        save()
    return state["guilds"][key]


def record(kind, key, value):
    state[kind][str(key)] = value
    save()


def remove(kind, key):
    state[kind].pop(str(key), None)
    save()

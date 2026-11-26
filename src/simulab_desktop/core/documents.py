"""@brief Bounded portable browser-compatible JSON and atomic local persistence."""
from __future__ import annotations

import json
import math
import os
from pathlib import Path
import re
import tempfile

from .registry import ComponentRegistry, RESOURCES

SCHEMAS = ("1.0.0", "1.1.0", "1.2.0", "1.3.0", "1.4.0")
BOARDS = ("uno", "nano", "mega2560", "esp32", "esp32s3", "yd-n16r8")
BLANK_SKETCH = "void setup() {\n}\n\nvoid loop() {\n}\n"
_BASE = {"uno", "led", "resistor", "switch", "junction"}
_DEVICES = {"ds3231", "mux4067", "dc-motor", "ws2812", "relay", "h-bridge"}
_EXPANDED = {"nano", "mega2560", "voltmeter", "ammeter", "hx711", "dht22",
             "stepper", "stepper-driver", "servo", "tactile-switch", "electromagnetic-switch",
             "arm-6dof", "universal-arm", "dobot-magician", "uarm-metal", "conveyor",
             "robotic-car", "ir-emitter", "ir-detector"}
_PARAMETER_BOUNDS = {
    "rangeV": (.001, 10000), "rangeA": (.000001, 10000),
    "shuntOhms": (.000001, 1000000), "rawValue": (-8388608, 8388607),
    "rawValueB": (-8388608, 8388607), "temperatureC": (-40, 80),
    "humidityPct": (0, 100), "stepsPerTurn": (1, 10000),
    "maxStepHz": (1, 100000), "minAngle": (-360, 360), "maxAngle": (-360, 360),
    "speedDegS": (.01, 2000), "ratedVoltage": (1, 48), "resistanceOhms": (1, 100000),
    "delayUs": (0, 1e6), "link1Mm": (1, 5000), "link2Mm": (1, 5000),
    "speedMps": (.001, 20), "trackM": (.01, 10), "xM": (-10000, 10000),
    "yM": (-10000, 10000), "rangeM": (.001, 10000),
}


def _object(value, field="object") -> dict:
    if not isinstance(value, dict):
        raise ValueError(f"Invalid {field}: expected an object")
    return value


def _text(value, maximum=200, field="text") -> str:
    if not isinstance(value, str) or len(value) > maximum:
        raise ValueError(f"Invalid {field}: expected text of at most {maximum} characters")
    return value


def _identifier(value) -> str:
    value = _text(value, 100, "identifier")
    if not re.fullmatch(r"[\w.-]+", value, re.ASCII):
        raise ValueError("Invalid identifier")
    return value


def _number(value, minimum, maximum, field="number"):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not minimum <= value <= maximum or not math.isfinite(value):
        raise ValueError(f"Invalid {field}: must be finite within {minimum}..{maximum}")
    return value


def _integer(value, field="integer") -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 1 or value > 2**53 - 1:
        raise ValueError(f"Invalid {field}: expected a positive safe integer")
    return value


def _json(text: str, limit: int):
    if not isinstance(text, str) or len(text) > limit:
        raise ValueError(f"Document exceeds {limit} character limit")
    def bad_constant(value):
        raise ValueError(f"Nonfinite JSON number: {value}")
    try:
        return json.loads(text, parse_constant=bad_constant)
    except (json.JSONDecodeError, RecursionError) as error:
        raise ValueError(f"Invalid JSON document: {error}") from error


def _endpoint(value) -> dict:
    value = _object(value, "endpoint")
    return {"componentId": _identifier(value.get("componentId")),
            "pinId": _identifier(value.get("pinId"))}


def _validate_properties(kind: str, properties: dict, registry: ComponentRegistry):
    effective_kind = registry.get(kind).get("engineKind", kind)
    if effective_kind not in _EXPANDED - {"nano", "mega2560", "tactile-switch"}:
        return
    for key, value in properties.items():
        if key in _PARAMETER_BOUNDS:
            _number(value, *_PARAMETER_BOUNDS[key], field=key)
        if key == "rateHz" and (isinstance(value, bool) or value not in (10, 80)):
            raise ValueError("rateHz must be 10 or 80")
        if key in ("blocked", "pressed") and not isinstance(value, bool):
            raise ValueError(f"{key} must be boolean")
        if key == "channel" and (not isinstance(value, str) or not 1 <= len(value) <= 100):
            raise ValueError("channel must be 1..100 characters")
    if effective_kind == "servo" and properties.get("minAngle", -90) > properties.get("maxAngle", 90):
        raise ValueError("Minimum angle must not exceed maximum angle")


def parse_project(text: str, registry: ComponentRegistry) -> dict:
    """@brief Validate untrusted circuit JSON, preserving explicit endpoint topology.

    @param text Browser CircuitProject schemas 1.0.0 through 1.4.0.
    @param registry Allowed built-in and explicitly installed plugin kinds.
    @return Sanitized independent portable circuit dictionary.
    """
    root = _object(_json(text, 2_000_000), "circuit")
    version = root.get("schemaVersion")
    if version not in SCHEMAS:
        raise ValueError("Unsupported circuit schema; expected 1.0.0 through 1.4.0")
    parts, wires = root.get("components"), root.get("wires")
    if not isinstance(parts, list) or len(parts) > 1000 or not isinstance(wires, list) or len(wires) > 5000:
        raise ValueError("Invalid component/wire arrays or limits exceeded")
    components = []
    endpoints = set()
    ids = set()
    for raw in parts:
        c = _object(raw, "component")
        identity = _identifier(c.get("id"))
        if identity in ids:
            raise ValueError("Duplicate component ID")
        ids.add(identity)
        kind = _text(c.get("kind"), field="component kind")
        definition = registry.get(kind)
        effective_kind = definition.get("engineKind", kind)
        minimum = 4 if effective_kind in ("serial-monitor", "debugger") else 3 if effective_kind in _EXPANDED else 2 if effective_kind in _DEVICES else 1 if effective_kind == "yd-esp32-s3" else 0
        if SCHEMAS.index(version) < minimum:
            raise ValueError(f"Component {kind} requires circuit schema {SCHEMAS[minimum]}")
        position = _object(c.get("position"), "position")
        properties = _object(c.get("properties"), "properties")
        if len(properties) > 50:
            raise ValueError("Too many component properties")
        props = {}
        for key, value in properties.items():
            if not isinstance(key, str) or len(key) > 100 or key in ("__proto__", "prototype", "constructor"):
                raise ValueError("Invalid property name")
            if isinstance(value, str):
                props[key] = _text(value, 1000, "property")
            elif isinstance(value, bool):
                props[key] = value
            else:
                props[key] = _number(value, -1e12, 1e12, "property")
        _validate_properties(kind, props, registry)
        rotation = c.get("rotation")
        if isinstance(rotation, bool) or not isinstance(rotation, (int, float)) or rotation not in (0, 90, 180, 270):
            raise ValueError("Rotation must be 0, 90, 180 or 270")
        components.append({"id": identity, "kind": kind, "label": _text(c.get("label")),
                           "position": {"x": _number(position.get("x"), -100000, 100000, "coordinate"),
                                        "y": _number(position.get("y"), -100000, 100000, "coordinate")},
                           "rotation": rotation, "properties": props})
        endpoints.update((identity, p["id"]) for p in definition["pins"])
    result = {"schemaVersion": version, "name": _text(root.get("name")), "components": components, "wires": []}
    wire_ids, pairs = set(), set()
    for raw in wires:
        wire = _object(raw, "wire")
        identity = _identifier(wire.get("id"))
        if identity in wire_ids:
            raise ValueError("Duplicate wire ID")
        wire_ids.add(identity)
        start, end = _endpoint(wire.get("from")), _endpoint(wire.get("to"))
        a, b = (start["componentId"], start["pinId"]), (end["componentId"], end["pinId"])
        if version != "1.4.0" and any(e[1] in ("DEBUG", "CONSOLE") for e in (a, b)):
            raise ValueError("Virtual instrument endpoints require schema 1.4.0")
        if a not in endpoints or b not in endpoints:
            raise ValueError("Wire references an unknown pin")
        pair = tuple(sorted((a, b)))
        if a == b or pair in pairs:
            raise ValueError("Self wire or duplicate connection")
        pairs.add(pair)
        color = _text(wire.get("color"), 9)
        if not re.fullmatch(r"#[0-9a-fA-F]{6}", color):
            raise ValueError("Wire color must use #RRGGBB")
        result["wires"].append({"id": identity, "from": start, "to": end, "color": color,
                                "label": _text(wire.get("label"))})
    return result


def new_workspace(registry: ComponentRegistry, board_kind: str | None = None) -> dict:
    """@brief Create a blank browser workspace, or explicitly place one controller with its starter.

    @param board_kind Optional catalogue controller kind; no reference firmware is selected implicitly.
    """
    project = {"schemaVersion": "1.4.0", "name": "Untitled circuit", "components": [], "wires": []}
    board, content = "uno", BLANK_SKETCH
    if board_kind is not None:
        effective_kind = registry.get(board_kind).get("engineKind", board_kind)
        if effective_kind not in ("uno", "nano", "mega2560", "yd-esp32-s3"):
            raise ValueError("Select a supported controller kind")
        project["components"].append(registry.create(board_kind, 80, 100))
        board = "esp32s3" if effective_kind == "yd-esp32-s3" else effective_kind
        starters_path = RESOURCES / "starters.json"
        if starters_path.is_file():
            starters = json.loads(starters_path.read_text(encoding="utf-8-sig"))
            starter = starters.get(effective_kind, {})
            content = starter.get("content", content)
    return {"version": "1.0.0", "circuit": project, "board": board,
            "files": [{"name": "sketch.ino", "content": content}],
            "activeFile": "sketch.ino", "activeTab": "hardware", "breakpoints": {}}


def parse_document(text: str, registry: ComponentRegistry) -> dict:
    """@brief Load either a circuit or IDE document and return a sanitized browser workspace v1."""
    root = _object(_json(text, 3_100_000), "workspace")
    if "schemaVersion" in root and "components" in root:
        workspace = new_workspace(registry)
        workspace["circuit"] = parse_project(text, registry)
        effective = [registry.get(c["kind"]).get("engineKind", c["kind"]) for c in workspace["circuit"]["components"]]
        boards = [kind for kind in effective if kind in ("uno", "nano", "mega2560", "yd-esp32-s3")]
        if len(boards) == 1:
            workspace["board"] = "esp32s3" if boards[0] == "yd-esp32-s3" else boards[0]
        return workspace
    if root.get("version") != "1.0.0" or root.get("board") not in BOARDS or root.get("activeTab") not in ("hardware", "code", "debugger", "serial"):
        raise ValueError("Invalid IDE workspace")
    raw_files = root.get("files")
    if not isinstance(raw_files, list) or not 1 <= len(raw_files) <= 32:
        raise ValueError("Expected 1..32 source files")
    files, names, source_bytes = [], set(), 0
    for raw in raw_files:
        raw = _object(raw, "source file")
        name = _text(raw.get("name"), 70, "filename")
        if not re.fullmatch(r"[A-Za-z][A-Za-z0-9_-]{0,63}\.(ino|h|hpp|cpp|c)", name) or re.match(r"^(con|prn|aux|nul|com\d|lpt\d)\.", name, re.I) or name.lower() in names:
            raise ValueError("Invalid or duplicate source filename")
        names.add(name.lower())
        content = _text(raw.get("content"), 1_000_000, "source content")
        try:
            source_bytes += len(content.encode("utf-8"))
        except UnicodeEncodeError as error:
            raise ValueError("Source contains invalid Unicode") from error
        f = {"name": name, "content": content}
        if "cursor" in raw:
            cursor = _object(raw["cursor"], "cursor")
            f["cursor"] = {"lineNumber": _integer(cursor.get("lineNumber"), "cursor line"),
                           "column": _integer(cursor.get("column"), "cursor column")}
        files.append(f)
    if source_bytes > 1_000_000 or "sketch.ino" not in names or root.get("activeFile") not in [f["name"] for f in files]:
        raise ValueError("Invalid source project: sketch.ino required, maximum 1 MB")
    breakpoints = _object(root.get("breakpoints"), "breakpoints")
    clean_breakpoints = {}
    for filename, lines in breakpoints.items():
        if filename not in [f["name"] for f in files] or not isinstance(lines, list) or len(lines) > 1000:
            raise ValueError("Invalid breakpoints")
        clean_breakpoints[filename] = [_integer(line, "breakpoint") for line in lines]
    return {"version": "1.0.0", "circuit": parse_project(json.dumps(root.get("circuit"), allow_nan=False), registry),
            "board": root["board"], "files": files, "activeFile": root["activeFile"],
            "activeTab": "hardware", "breakpoints": clean_breakpoints}


def serialize_document(workspace: dict, registry: ComponentRegistry) -> str:
    """@brief Serialize validated portable fields only; tokens and runtime artifacts never persist."""
    try:
        clean = parse_document(json.dumps(workspace, ensure_ascii=True, allow_nan=False), registry)
        return json.dumps(clean, ensure_ascii=True, indent=2, allow_nan=False) + "\n"
    except (TypeError, RecursionError) as error:
        raise ValueError(f"Invalid portable document: {error}") from error


def save_document(path: str | Path, workspace: dict, registry: ComponentRegistry) -> None:
    """@brief Validate fully, flush a same-directory temporary file and atomically replace the destination."""
    data = serialize_document(workspace, registry)
    target = Path(path).expanduser().absolute()
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", newline="\n", prefix=f".{target.name}.", suffix=".tmp", dir=target.parent, delete=False) as stream:
            temporary = Path(stream.name)
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, target)
        temporary = None
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def load_document(path: str | Path, registry: ComponentRegistry) -> dict:
    """@brief Read a bounded UTF-8 document from a host-selected local path."""
    target = Path(path)
    try:
        with target.open("rb") as stream:
            raw = stream.read(12_400_005)
        if len(raw) > 12_400_004:
            raise ValueError("Document exceeds maximum UTF-8 size")
        return parse_document(raw.decode("utf-8-sig"), registry)
    except UnicodeError as error:
        raise ValueError("Document must use valid UTF-8") from error

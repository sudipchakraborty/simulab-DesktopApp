"""@brief Immutable portable circuit edits with explicit endpoint connectivity."""
from __future__ import annotations

from copy import deepcopy
import json
import math
from uuid import uuid4

from .registry import ComponentRegistry
from .netlist import endpoint_key, has_endpoint


def _coordinate(value):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or abs(value) > 100000 or not math.isfinite(value):
        raise ValueError("Coordinate must be finite and within +/-100000")
    return value


def _validate(project, registry):
    if registry is None:
        return project
    from .documents import parse_project
    return parse_project(json.dumps(project, allow_nan=False), registry)


def add_component(project: dict, component: dict, registry: ComponentRegistry | None = None) -> dict:
    """@brief Add an independent component dict; upgrade edits to the current public schema."""
    if any(c["id"] == component["id"] for c in project["components"]):
        raise ValueError("Duplicate component ID")
    result = deepcopy(project)
    result["schemaVersion"] = "1.4.0"
    result["components"].append(deepcopy(component))
    return _validate(result, registry)


def delete_components(project: dict, component_ids) -> dict:
    """@brief Remove explicitly selected components and only their incident wires."""
    identities = {component_ids} if isinstance(component_ids, str) else set(component_ids)
    result = deepcopy(project)
    result["components"] = [c for c in result["components"] if c["id"] not in identities]
    result["wires"] = [w for w in result["wires"] if w["from"]["componentId"] not in identities and w["to"]["componentId"] not in identities]
    return result


def delete_wires(project: dict, wire_ids) -> dict:
    """@brief Remove selected wire IDs without modifying component terminals."""
    identities = {wire_ids} if isinstance(wire_ids, str) else set(wire_ids)
    result = deepcopy(project)
    result["wires"] = [w for w in result["wires"] if w["id"] not in identities]
    return result


def connect(project: dict, from_endpoint: dict, to_endpoint: dict, registry: ComponentRegistry,
            color: str = "#5bbfa8", label: str = "") -> dict:
    """@brief Connect two named pins; shared pins branch, self and duplicate wires fail."""
    if not has_endpoint(project, from_endpoint, registry) or not has_endpoint(project, to_endpoint, registry):
        raise ValueError("Connect to a defined component pin")
    a, b = endpoint_key(from_endpoint), endpoint_key(to_endpoint)
    if a == b:
        raise ValueError("A wire needs two distinct endpoints")
    for wire in project["wires"]:
        if {endpoint_key(wire["from"]), endpoint_key(wire["to"])} == {a, b}:
            raise ValueError("These pins are already connected by a wire")
    result = deepcopy(project)
    if from_endpoint["pinId"] in ("DEBUG", "CONSOLE") or to_endpoint["pinId"] in ("DEBUG", "CONSOLE"):
        result["schemaVersion"] = "1.4.0"
    result["wires"].append({"id": str(uuid4()), "from": deepcopy(from_endpoint), "to": deepcopy(to_endpoint), "color": color, "label": label})
    return _validate(result, registry)


def clone_components(project: dict, component_ids, dx: float = 30, dy: float = 30) -> dict:
    """@brief Clone a selection and its internal wires with fresh IDs and caller-supplied offset."""
    identities = {component_ids} if isinstance(component_ids, str) else set(component_ids)
    _coordinate(dx)
    _coordinate(dy)
    result = deepcopy(project)
    mapping = {}
    for original in project["components"]:
        if original["id"] not in identities:
            continue
        cloned = deepcopy(original)
        mapping[original["id"]] = cloned["id"] = str(uuid4())
        cloned["position"] = {"x": _coordinate(cloned["position"]["x"] + dx), "y": _coordinate(cloned["position"]["y"] + dy)}
        result["components"].append(cloned)
    for original in project["wires"]:
        if original["from"]["componentId"] in mapping and original["to"]["componentId"] in mapping:
            cloned = deepcopy(original)
            cloned["id"] = str(uuid4())
            for side in ("from", "to"):
                cloned[side]["componentId"] = mapping[cloned[side]["componentId"]]
            result["wires"].append(cloned)
    if len(result["components"]) > 1000 or len(result["wires"]) > 5000:
        raise ValueError("Cloned selection exceeds component/wire limits")
    return result


def move_components(project: dict, positions: dict[str, dict]) -> dict:
    """@brief Set absolute positions for named components; all wire endpoint identities remain unchanged."""
    result = deepcopy(project)
    for component in result["components"]:
        if component["id"] in positions:
            point = positions[component["id"]]
            component["position"] = {"x": _coordinate(point["x"]), "y": _coordinate(point["y"])}
    return result


def split_wire(project: dict, wire_id: str, x: float, y: float, registry: ComponentRegistry) -> dict:
    """@brief Split one selected wire through a real junction; crossing wires remain untouched."""
    original = next((w for w in project["wires"] if w["id"] == wire_id), None)
    if original is None:
        raise ValueError("The selected wire no longer exists")
    junction = registry.create("junction", x, y)
    result = add_component(project, junction)
    endpoint = {"componentId": junction["id"], "pinId": "J"}
    result["wires"] = [w for w in result["wires"] if w["id"] != wire_id]
    first, second = deepcopy(original), deepcopy(original)
    first["to"] = deepcopy(endpoint)
    second["from"] = deepcopy(endpoint)
    second["id"] = str(uuid4())
    result["wires"].extend((first, second))
    return _validate(result, registry)


# Simple names support hosts with their own command/toolbar naming conventions.
clone = clone_components
delete = delete_components
move = move_components
add = add_component

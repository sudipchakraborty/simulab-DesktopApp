"""@brief Explicit named-terminal topology and structural ERC; drawing geometry is irrelevant."""
from __future__ import annotations

from .registry import ComponentRegistry

_YD_RAILS = [["P1.1", "P1.2"], ["P1.22", "P2.1", "P2.21", "P2.22"]]


def endpoint_key(endpoint: dict) -> tuple[str, str]:
    """@brief Unambiguous component/pin identity independent of drawing position."""
    return endpoint["componentId"], endpoint["pinId"]


def has_endpoint(project: dict, endpoint: dict, registry: ComponentRegistry) -> bool:
    """@brief Check that both the component and its named terminal exist."""
    if not isinstance(endpoint, dict):
        return False
    part = next((c for c in project["components"] if c["id"] == endpoint.get("componentId")), None)
    return part is not None and any(p["id"] == endpoint.get("pinId") for p in registry.pins(part["kind"]))


def build_nets(project: dict, registry: ComponentRegistry) -> list[dict]:
    """@brief Return deterministic explicit connected components, including isolated pins.

    @param project Portable circuit; crossings never introduce an edge.
    @param registry Component pin definitions and optional internalNets.
    @return Rows with stable deterministic net IDs and endpoint dictionaries.
    """
    adjacency: dict[tuple[str, str], set] = {}
    for component in project["components"]:
        for pin in registry.pins(component["kind"]):
            adjacency[(component["id"], pin["id"])] = set()
    def join(a, b):
        if a in adjacency and b in adjacency:
            adjacency[a].add(b)
            adjacency[b].add(a)
    for component in project["components"]:
        definition = registry.get(component["kind"])
        groups = definition.get("internalNets", [])
        if definition.get("engineKind", component["kind"]) == "yd-esp32-s3" and not groups:
            groups = _YD_RAILS
        for group in groups:
            pins = group.get("pinIds", []) if isinstance(group, dict) else group
            for other in pins[1:]:
                join((component["id"], pins[0]), (component["id"], other))
    for wire in project["wires"]:
        join(endpoint_key(wire["from"]), endpoint_key(wire["to"]))
    seen, nets = set(), []
    for start in sorted(adjacency):
        if start in seen:
            continue
        stack, members = [start], []
        seen.add(start)
        while stack:
            current = stack.pop()
            members.append(current)
            for neighbor in adjacency[current]:
                if neighbor not in seen:
                    seen.add(neighbor)
                    stack.append(neighbor)
        nets.append({"id": f"net-{len(nets)+1}", "endpoints": [
            {"componentId": component, "pinId": pin} for component, pin in sorted(members)]})
    return nets


def validate_circuit(project: dict, registry: ComponentRegistry) -> list[dict]:
    """@brief Structural ERC only; no current, transient or physical safety claims."""
    issues = []
    components = {c["id"]: c for c in project["components"]}
    pins = {(c["id"], p["id"]): p for c in project["components"] for p in registry.pins(c["kind"])}
    for wire in project["wires"]:
        if not has_endpoint(project, wire["from"], registry) or not has_endpoint(project, wire["to"], registry):
            issues.append({"severity": "error", "message": f"Wire {wire['id']} has an unknown pin."})
    for net in build_nets(project, registry):
        members = net["endpoints"]
        definitions = [pins[endpoint_key(e)] for e in members]
        types = {p.get("electricalType", "passive") for p in definitions}
        if len(members) == 1:
            endpoint = members[0]
            component = components[endpoint["componentId"]]
            kind = registry.get(component["kind"]).get("engineKind", component["kind"])
            if kind not in ("uno", "nano", "mega2560", "yd-esp32-s3") and not next(iter(types)).startswith("virtual-"):
                issues.append({"severity": "warning", "message": f"{component['label']}.{endpoint['pinId']} is unconnected."})
        if "power" in types and "ground" in types:
            issues.append({"severity": "error", "message": f"{net['id']}: direct power-to-ground short."})
        rails = {p.get("label", p["id"]) for p in definitions if p.get("electricalType") == "power" and p.get("label", p["id"]) in ("5V", "3V3")}
        if len(rails) > 1:
            issues.append({"severity": "error", "message": f"{net['id']}: incompatible power rails connected."})
        if any(t.startswith("virtual-") for t in types) and any(not p.get("electricalType", "").startswith("virtual-") and components[e["componentId"]]["kind"] != "junction" for p, e in zip(definitions, members)):
            issues.append({"severity": "warning", "message": f"{net['id']}: virtual simulator service net is electrically isolated; use DEBUG/CONSOLE ports only."})
    return issues

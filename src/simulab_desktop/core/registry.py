"""@brief Parameter-initialized component definitions and explicitly loaded plugins."""
from __future__ import annotations

from copy import deepcopy
import importlib.util
import json
import math
from pathlib import Path
import re
import sys
from typing import Iterable
from uuid import uuid4


RESOURCES = Path(__file__).resolve().parents[1] / "resources"


class ComponentRegistry:
    """@brief Own independent catalogue data; executable plugins are explicitly trusted inputs.

    @param catalogue_path JSON mapping portable kind IDs to component definitions.
    """

    def __init__(self, catalogue_path: str | Path):
        self.catalogue_path = Path(catalogue_path)
        raw = json.loads(self.catalogue_path.read_text(encoding="utf-8-sig"))
        if not isinstance(raw, dict) or not raw:
            raise ValueError("Component catalogue must be a nonempty object")
        self._definitions: dict[str, dict] = {}
        for kind, definition in raw.items():
            self.register(kind, definition)
        self._builtins = frozenset(self._definitions)
        self.loaded_plugins: list[str] = []

    @property
    def definitions(self) -> dict[str, dict]:
        """@brief Return isolated definitions so one UI cannot mutate another host's registry."""
        return deepcopy(self._definitions)

    def register(self, kind: str, definition: dict) -> None:
        """@brief Register one independent definition; duplicate kinds never silently override.

        @param kind Stable plugin type used in saved documents.
        @param definition Pins/defaults and optional upstream engineKind model alias.
        """
        if not isinstance(kind, str) or not re.fullmatch(r"[\w.-]{1,100}", kind, re.ASCII):
            raise ValueError("Invalid component kind identifier")
        if kind in self._definitions:
            raise ValueError(f"Component kind already registered: {kind}")
        if not isinstance(definition, dict):
            raise ValueError(f"Invalid definition for {kind}")
        pins = definition.get("pins")
        if not isinstance(pins, list) or len(pins) > 200:
            raise ValueError(f"Invalid pins for {kind}")
        seen = set()
        for pin in pins:
            if not isinstance(pin, dict) or not isinstance(pin.get("id"), str) or not re.fullmatch(r"[\w.-]{1,100}", pin["id"], re.ASCII):
                raise ValueError(f"Invalid pin identifier for {kind}")
            if pin["id"] in seen:
                raise ValueError(f"Duplicate pin identifier for {kind}")
            seen.add(pin["id"])
        defaults = definition.get("defaultProperties", {})
        if not isinstance(defaults, dict):
            raise ValueError(f"Invalid default properties for {kind}")
        item = deepcopy(definition)
        item.setdefault("name", kind)
        item.setdefault("description", "")
        item.setdefault("category", "Module")
        item["defaultProperties"] = deepcopy(defaults)
        for pin in item["pins"]:
            pin.setdefault("label", pin["id"])
            pin.setdefault("electricalType", "passive")
        self._definitions[kind] = item

    def get(self, kind: str) -> dict:
        """@brief Return a definition copy or raise a useful missing-plugin error."""
        if kind not in self._definitions:
            raise ValueError(f"Unknown component kind '{kind}'; install its component plugin")
        return deepcopy(self._definitions[kind])

    def pins(self, kind: str) -> list[dict]:
        """@brief Return physical and explicitly virtual terminals for a registered kind."""
        return self.get(kind)["pins"]

    def category(self, kind: str) -> str:
        """@brief Return the host-independent palette category."""
        return self.get(kind)["category"]

    def create(self, kind: str, x: float = 0, y: float = 0) -> dict:
        """@brief Instantiate fresh identity and copied defaults at bounded scene coordinates."""
        definition = self.get(kind)
        for coordinate in (x, y):
            if isinstance(coordinate, bool) or not isinstance(coordinate, (int, float)) or abs(coordinate) > 100000 or not math.isfinite(coordinate):
                raise ValueError("Component coordinate must be finite and within +/-100000")
        return {"id": str(uuid4()), "kind": kind, "label": definition["name"],
                "position": {"x": x, "y": y}, "rotation": 0,
                "properties": deepcopy(definition["defaultProperties"])}

    def load_plugins(self, paths: Iterable[str | Path]) -> list[str]:
        """@brief Execute explicit local .py plugins exporting register(registry).

        @param paths Files or directories; a directory loads its immediate .py children.
        @return Loaded absolute paths. Failed plugin registrations roll back atomically.
        """
        loaded = []
        for supplied in paths:
            path = Path(supplied).expanduser().resolve()
            if not path.exists():
                raise ValueError(f"Plugin path does not exist: {path}")
            files = sorted(path.glob("*.py")) if path.is_dir() else [path]
            for file in files:
                if file.name.startswith("_"):
                    continue
                if file.suffix.lower() != ".py":
                    raise ValueError(f"Component plugin must be a .py file: {file}")
                if str(file) in self.loaded_plugins:
                    continue
                spec = importlib.util.spec_from_file_location(f"simulab_component_{uuid4().hex}", file)
                if spec is None or spec.loader is None:
                    raise ValueError(f"Cannot load plugin: {file}")
                module = importlib.util.module_from_spec(spec)
                before = deepcopy(self._definitions)
                try:
                    sys.modules[spec.name] = module
                    spec.loader.exec_module(module)
                    callback = getattr(module, "register", None)
                    if not callable(callback):
                        raise ValueError("Plugin must export register(registry)")
                    callback(self)
                except Exception as error:
                    self._definitions = before
                    sys.modules.pop(spec.name, None)
                    raise ValueError(f"Plugin {file.name} failed: {error}") from error
                self.loaded_plugins.append(str(file))
                loaded.append(str(file))
        return loaded

    def engine_project(self, project: dict) -> dict:
        """@brief Map custom kind aliases for genuine upstream execution without changing saved data.

        @return Deep copy using upstream kinds. Missing models or incompatible pins raise ValueError.
        """
        from .documents import parse_project
        mapped = parse_project(json.dumps(project, allow_nan=False), self)
        for component in mapped["components"]:
            kind = component["kind"]
            if kind in self._builtins:
                continue
            alias = self._definitions[kind].get("engineKind")
            if not isinstance(alias, str) or alias not in self._builtins:
                raise ValueError(f"Component '{kind}' has no supported execution model; configure engineKind")
            own_pins = {p["id"] for p in self.pins(kind)}
            model_pins = {p["id"] for p in self.pins(alias)}
            if own_pins != model_pins:
                raise ValueError(f"Component '{kind}' pins do not match engineKind '{alias}'")
            component["kind"] = alias
        mapped["schemaVersion"] = "1.4.0"
        return mapped


def create_registry(plugin_paths: Iterable[str | Path] = ()) -> ComponentRegistry:
    """@brief Load installed resources and caller-selected plugins; no project-root assumptions."""
    registry = ComponentRegistry(RESOURCES / "catalog.json")
    registry.load_plugins(plugin_paths)
    return registry

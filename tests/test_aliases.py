"""Plugin aliases must stay usable through portable import and real native execution."""

import json
from simulab_desktop.core.registry import create_registry
from simulab_desktop.core.documents import new_workspace, parse_document


def test_controller_alias_document_profile_and_starter():
    registry = create_registry()
    definition = registry.get("nano")
    definition["engineKind"] = "nano"
    registry.register("plugin.nano", definition)
    blank = new_workspace(registry)
    blank["circuit"]["components"].append(registry.create("plugin.nano"))
    imported = parse_document(json.dumps(blank["circuit"]), registry)
    assert imported["board"] == "nano"
    explicit = new_workspace(registry, "plugin.nano")
    assert explicit["board"] == "nano"
    assert explicit["circuit"]["components"][0]["kind"] == "plugin.nano"
    assert "digitalWrite" in explicit["files"][0]["content"]


def test_native_instrument_alias_is_selectable(qtbot):
    from simulab_desktop.ui.panels import InstrumentPanel
    registry = create_registry()
    definition = registry.get("serial-monitor")
    definition["engineKind"] = "serial-monitor"
    registry.register("plugin.terminal", definition)
    project = new_workspace(registry)["circuit"]
    instrument = registry.create("plugin.terminal")
    project["components"].append(instrument)
    panel = InstrumentPanel(registry=registry)
    qtbot.addWidget(panel)
    panel.set_project(project)
    assert panel.select.currentData() == instrument["id"]

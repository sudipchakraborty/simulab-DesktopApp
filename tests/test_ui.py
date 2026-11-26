"""Meaningful native interaction checks; no browser or web server required."""

import json
from copy import deepcopy

from PySide6.QtCore import QPointF, Qt
from PySide6.QtTest import QTest


def test_native_scene_connect_move_and_crossings(qapp):
    from simulab_desktop.core.registry import create_registry
    from simulab_desktop.core.documents import new_workspace
    from simulab_desktop.ui.canvas import CircuitScene
    registry = create_registry()
    project = new_workspace(registry)["circuit"]
    a = registry.create("uno", 0, 0)
    b = registry.create("led", 420, 0)
    project["components"] = [a, b]
    scene = CircuitScene(registry)
    scene.set_project(project)
    edits = []
    scene.project_edited.connect(edits.append)
    scene.connect_pins({"componentId": a["id"], "pinId": "D13"}, {"componentId": b["id"], "pinId": "A"})
    assert len(edits[-1]["wires"]) == 1
    before = scene.wires[edits[-1]["wires"][0]["id"]].path().boundingRect()
    item = scene.parts[b["id"]]
    item.setPos(600, 160)
    scene.commit_positions()
    after = scene.wires[edits[-1]["wires"][0]["id"]].path().boundingRect()
    assert before != after
    assert edits[-1]["components"][1]["position"] == {"x": 600.0, "y": 160.0}
    assert len(edits[-1]["wires"]) == 1


def test_native_palette_and_inspector_emit_real_changes(qtbot):
    from simulab_desktop.core.registry import create_registry
    from simulab_desktop.ui.panels import LibraryPanel, InspectorPanel
    registry = create_registry()
    library = LibraryPanel(registry)
    qtbot.addWidget(library)
    library.search.setText("resistor")
    assert library.visible_kinds() == ["resistor"]
    inspector = InspectorPanel(registry)
    qtbot.addWidget(inspector)
    resistor = registry.create("resistor")
    inspector.set_component(resistor)
    changes = []
    inspector.component_edited.connect(changes.append)
    inspector.fields["resistanceOhms"].setValue(1000)
    inspector.apply()
    assert changes[-1]["properties"]["resistanceOhms"] == 1000


def test_multifile_editor_preserves_source(qtbot):
    from simulab_desktop.ui.editor import CodePanel
    panel = CodePanel()
    qtbot.addWidget(panel)
    files = [{"name": "sketch.ino", "content": "#include \"x.h\"\nvoid setup() {}\nvoid loop() {}"}, {"name": "x.h", "content": "#define X 42"}]
    panel.set_files(files, "sketch.ino")
    panel.editors["x.h"].setPlainText("#define X 99")
    saved = panel.files()
    assert saved[0]["content"] == files[0]["content"]
    assert saved[1]["content"] == "#define X 99"


def test_window_roundtrip_history_and_source_ownership(qtbot, tmp_path):
    from simulab_desktop.core.registry import create_registry
    from simulab_desktop.ui.main_window import MainWindow
    window = MainWindow(create_registry(), data_dir=tmp_path, restore=False)
    qtbot.addWidget(window)
    window.place_component("uno")
    window.place_component("resistor")
    assert len(window.project["components"]) == 2
    window.undo()
    assert len(window.project["components"]) == 1
    window.redo()
    assert len(window.project["components"]) == 2
    window.code.editors["sketch.ino"].setPlainText("void setup() {}\nvoid loop() {}\n// saved native source")
    destination = tmp_path / "native.simulab.json"
    window.save_to(destination)
    document = json.loads(destination.read_text(encoding="utf-8"))
    assert "saved native source" in document["files"][0]["content"]
    assert "token" not in destination.read_text(encoding="utf-8").lower()
    assert document["circuit"]["schemaVersion"] == "1.4.0"
    window.runtime_owner = "manual"
    window.code.editors["sketch.ino"].appendPlainText("// manual image stays independent")
    assert window.runtime_owner == "manual"
    window.dirty = False
    window.close()


def test_placing_controller_preserves_custom_source_and_selects_target(qtbot, tmp_path):
    from simulab_desktop.core.registry import create_registry
    from simulab_desktop.ui.main_window import MainWindow
    window = MainWindow(create_registry(), data_dir=tmp_path, restore=False)
    qtbot.addWidget(window)
    source = "// custom S3 source\nvoid setup(){}\nvoid loop(){}"
    window.code.editors["sketch.ino"].setPlainText(source)
    window.place_component("yd-esp32-s3")
    assert window.board_combo.currentData() == "esp32s3"
    assert window.code.files()[0]["content"] == source
    window.dirty = False
    window.close()


def test_removing_source_file_prunes_its_breakpoints(qtbot, tmp_path):
    from simulab_desktop.core.registry import create_registry
    from simulab_desktop.ui.main_window import MainWindow
    window = MainWindow(create_registry(), data_dir=tmp_path, restore=False)
    qtbot.addWidget(window)
    document = deepcopy(window.document)
    document["files"].append({"name": "x.h", "content": "#define X 1"})
    document["breakpoints"] = {"x.h": [1]}
    window._set_document(document, dirty=False)
    window.code._remove_file(1)
    assert "x.h" not in window.document["breakpoints"]
    window.save_to(tmp_path / "removed-source.json")
    window.dirty = False
    window.close()


def test_unknown_led_projection_clears_previous_high(qapp):
    from simulab_desktop.core.registry import create_registry
    from simulab_desktop.core.documents import new_workspace
    from simulab_desktop.ui.canvas import CircuitScene
    registry = create_registry()
    project = new_workspace(registry)["circuit"]
    led = registry.create("led")
    project["components"].append(led)
    scene = CircuitScene(registry)
    scene.set_project(project)
    scene.apply_projection({"ledStates": {led["id"]: True}})
    assert scene.parts[led["id"]].lit is True
    scene.apply_projection({"ledStates": {led["id"]: None}})
    assert scene.parts[led["id"]].lit is None


def test_native_junction_pin_matches_requested_split_position(qapp):
    from simulab_desktop.core.registry import create_registry
    from simulab_desktop.core.documents import new_workspace
    from simulab_desktop.core.editing import connect
    from simulab_desktop.ui.canvas import CircuitScene
    registry = create_registry()
    project = new_workspace(registry)["circuit"]
    a, b = registry.create("resistor"), registry.create("led", 400, 0)
    project["components"] = [a, b]
    project = connect(project, {"componentId": a["id"], "pinId": "2"}, {"componentId": b["id"], "pinId": "A"}, registry)
    scene = CircuitScene(registry)
    scene.set_project(project)
    scene.split_wire(project["wires"][0]["id"], 100, 100)
    junction = next(c for c in scene.project["components"] if c["kind"] == "junction")
    assert scene.pin_position({"componentId": junction["id"], "pinId": "J"}) == QPointF(100, 100)


def test_avr_onboard_indicator_uses_actual_d13_projection(qapp):
    from simulab_desktop.core.registry import create_registry
    from simulab_desktop.core.documents import new_workspace
    from simulab_desktop.ui.canvas import CircuitScene
    registry = create_registry()
    project = new_workspace(registry, "uno")["circuit"]
    board = project["components"][0]
    scene = CircuitScene(registry)
    scene.set_project(project)
    scene.apply_projection({"pinStates": {board["id"]: {"D13": 1}}})
    assert scene.parts[board["id"]].lit is True


def test_missing_engine_keeps_error_status_visible(qtbot, tmp_path):
    from simulab_desktop.core.registry import create_registry
    from simulab_desktop.ui.main_window import MainWindow
    window = MainWindow(create_registry(), data_dir=tmp_path, restore=False)
    qtbot.addWidget(window)
    window.place_component("uno")
    window.runtime.node = None
    window.load_reference()
    assert window.runtime_state == "error"
    assert window.state_label.text() == "Execution error"
    window.dirty = False
    window.close()


def test_controller_plugin_alias_selects_and_renders_real_target(qtbot, tmp_path):
    from simulab_desktop.core.registry import create_registry
    from simulab_desktop.ui.main_window import MainWindow
    registry = create_registry()
    definition = registry.get("nano")
    definition["engineKind"] = "nano"
    definition["name"] = "Reusable Nano module"
    registry.register("plugin.nano", definition)
    window = MainWindow(registry, data_dir=tmp_path, restore=False)
    qtbot.addWidget(window)
    window.place_component("plugin.nano")
    assert window._target() == "nano"
    assert window.board_combo.currentData() == "nano"
    part = next(iter(window.scene.parts.values()))
    assert part.render_kind == "nano"
    window.dirty = False
    window.close()

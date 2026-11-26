"""@brief Native application composition; domain and services stay independently reusable."""

from __future__ import annotations

from copy import deepcopy
import base64
import hashlib
import json
from pathlib import Path
import threading

from PySide6.QtCore import QByteArray, QPointF, Qt, QThreadPool, QTimer
from PySide6.QtGui import QAction, QActionGroup, QFont, QKeySequence
from PySide6.QtWidgets import QApplication, QComboBox, QDialog, QDialogButtonBox, QDockWidget, QFileDialog, QFormLayout, QHBoxLayout, QInputDialog, QLabel, QLineEdit, QMainWindow, QMessageBox, QProgressBar, QPushButton, QSplitter, QToolBar, QVBoxLayout, QWidget, QPlainTextEdit

from .. import __version__
from ..core import editing
from ..core.documents import load_document, new_workspace, parse_project, save_document, serialize_document
from ..core.history import History
from ..core.netlist import build_nets, validate_circuit
from ..paths import data_directory, resource_path
from ..services.runtime import RuntimeProcess
from ..services.tasks import BackgroundTask
from .canvas import BOARDS, CircuitScene, CircuitView
from .editor import CodePanel
from .panels import InspectorPanel, InstrumentPanel, LibraryPanel, OutputPanel
from .theme import apply_theme

TARGETS = {"uno": "uno", "nano": "nano", "mega2560": "mega2560", "yd-esp32-s3": "esp32s3"}


class MainWindow(QMainWindow):
    """@brief Inject a catalogue, local data directory and optional compiler service.
    @param registry Reusable component registry, including caller-selected plugins.
    @param data_dir Local persistence/cache directory; defaults to the user's app data.
    @param compiler Optional service implementing status/compile/fetch_artifact/close.
    @param restore Restore native recovery/settings if present.
    """

    def __init__(self, registry, *, data_dir=None, compiler=None, restore=True):
        super().__init__()
        self.registry = registry
        self.data_dir = data_directory(data_dir)
        self.document = new_workspace(registry)
        self.history = History(self.document["circuit"])
        self.file_path: Path | None = None
        self.dirty = False
        self.generation = 0
        self.runtime_owner: str | None = None
        self.runtime_state = "unloaded"
        self.runtime = RuntimeProcess(parent=self)
        self.runtime.message.connect(self._runtime_message)
        self.runtime.failed.connect(self._runtime_error)
        self._load_request = None
        self._start_session = None
        self._speed_mode = "maximum"
        self._loaded_key = None
        self._last_build = None
        self._clipboard = None
        self._tasks: set[BackgroundTask] = set()
        self._compiler = compiler
        self._compiler_lock = threading.Lock()
        self._compile_cancel = threading.Event()
        self._busy = False
        self._closing = False
        self._updating = False
        self.thread_pool = QThreadPool(self)
        self.thread_pool.setMaxThreadCount(3)
        self._settings = self._read_settings() if restore else {}
        self.resize(1540, 960)
        self.setMinimumSize(1000, 650)
        self.setObjectName("SimuLabDesktopWindow")
        self._build_ui()
        self._build_menus()
        self._build_toolbar()
        self.autosave_timer = QTimer(self)
        self.autosave_timer.setSingleShot(True)
        self.autosave_timer.setInterval(900)
        self.autosave_timer.timeout.connect(self._autosave)
        self._set_document(self.document, dirty=False)
        if restore:
            self._restore_layout()
            recovery = self.data_dir / "recovery.simulab.json"
            if recovery.is_file():
                try:
                    self._set_document(load_document(recovery, registry), dirty=True)
                    self._notice("Recovered the last native workspace. Save it to a project file when ready.")
                except (ValueError, OSError) as error:
                    self.output.append(f"Recovery could not be loaded: {error}")
        self._title()

    @property
    def project(self):
        return self.document["circuit"]

    def _build_ui(self):
        self.scene = CircuitScene(self.registry)
        self.view = CircuitView(self.scene)
        self.view.setObjectName("HardwareCanvas")
        self.code = CodePanel()
        self.code.changed.connect(self._source_changed)
        self.splitter = QSplitter(Qt.Orientation.Horizontal)
        self.splitter.addWidget(self.view)
        self.splitter.addWidget(self.code)
        self.splitter.setSizes([920, 470])
        self.setCentralWidget(self.splitter)
        self.library = LibraryPanel(self.registry)
        self.library.place_requested.connect(self.place_component)
        self.inspector = InspectorPanel(self.registry)
        self.inspector.component_edited.connect(self._edit_component)
        self.output = OutputPanel()
        self.instruments = InstrumentPanel(registry=self.registry)
        self.instruments.action_requested.connect(self._instrument_action)
        self.docks = {}
        for key, title, widget, area in [("library", "Components", self.library, Qt.DockWidgetArea.LeftDockWidgetArea), ("inspector", "Properties", self.inspector, Qt.DockWidgetArea.RightDockWidgetArea), ("output", "Output", self.output, Qt.DockWidgetArea.BottomDockWidgetArea), ("instruments", "Wired instruments", self.instruments, Qt.DockWidgetArea.BottomDockWidgetArea)]:
            dock = QDockWidget(title, self)
            dock.setObjectName("dock-" + key)
            dock.setWidget(widget)
            self.addDockWidget(area, dock)
            self.docks[key] = dock
        self.tabifyDockWidget(self.docks["output"], self.docks["instruments"])
        self.docks["output"].raise_()
        self.resizeDocks([self.docks["library"], self.docks["inspector"]], [230, 265], Qt.Orientation.Horizontal)
        self.resizeDocks([self.docks["output"]], [200], Qt.Orientation.Vertical)
        # Output is opened by a build/check/instrument action, giving Hardware the initial height.
        self.docks["output"].hide()
        self.docks["instruments"].hide()
        self.scene.project_edited.connect(self.commit_project)
        self.scene.selection_changed.connect(self._selection_changed)
        self.scene.request_place.connect(self.place_component)
        self.scene.command_requested.connect(self._canvas_command)
        self.scene.device_toggled.connect(self._toggle_device)
        self.scene.instrument_requested.connect(self._open_instrument)
        self.scene.notice.connect(self._notice)
        self.state_label = QLabel("No firmware loaded")
        self.time_label = QLabel("0.000 s")
        self.selection_label = QLabel("0 parts · 0 wires")
        self.progress = QProgressBar()
        self.progress.setMaximumWidth(240)
        self.progress.hide()
        self.statusBar().addPermanentWidget(self.progress)
        self.statusBar().addPermanentWidget(self.selection_label)
        self.statusBar().addPermanentWidget(self.state_label)
        self.statusBar().addPermanentWidget(self.time_label)
        self.statusBar().showMessage("Native Hardware · wheel zoom · Space/middle-drag pan · click two pins to wire")

    def _action(self, text, callback, shortcut=None):
        action = QAction(text, self)
        action.triggered.connect(callback)
        if shortcut:
            action.setShortcut(shortcut)
        return action

    def _build_menus(self):
        file_menu = self.menuBar().addMenu("&File")
        for title, callback, shortcut in [("New workspace", self.new_project, QKeySequence.StandardKey.New), ("Open workspace / circuit…", self.open_project, QKeySequence.StandardKey.Open), ("Save workspace", self.save_project, QKeySequence.StandardKey.Save), ("Save workspace as…", lambda: self.save_project(save_as=True), QKeySequence.StandardKey.SaveAs), ("Export circuit JSON…", self.export_circuit, None), ("Export canvas PNG…", self.export_image, None)]:
            file_menu.addAction(self._action(title, callback, shortcut))
        examples = file_menu.addMenu("Open example")
        for path in sorted(resource_path("examples").glob("*.json")):
            examples.addAction(self._action(path.stem.replace("-", " ").title(), lambda _checked=False, p=path: self.open_path(p, example=True)))
        file_menu.addSeparator()
        file_menu.addAction(self._action("Exit", self.close, QKeySequence.StandardKey.Quit))
        edit = self.menuBar().addMenu("&Edit")
        self.undo_action = self._action("Undo", self.undo, QKeySequence.StandardKey.Undo)
        self.redo_action = self._action("Redo", self.redo, QKeySequence.StandardKey.Redo)
        edit.addAction(self.undo_action)
        edit.addAction(self.redo_action)
        edit.addSeparator()
        for label, command in [("Copy selection", "copy"), ("Paste selection", "paste"), ("Duplicate", "duplicate"), ("Rotate 90°", "rotate"), ("Delete selection", "delete"), ("Select all", "select_all")]:
            edit.addAction(self._action(label, lambda _checked=False, value=command: self._canvas_command(value)))
        view_menu = self.menuBar().addMenu("&View")
        view_menu.addAction(self._action("Fit circuit", self.view.fit_circuit, "Ctrl+0"))
        self.code_action = self._action("Code editor", self._toggle_code)
        self.code_action.setCheckable(True)
        self.code_action.setChecked(True)
        view_menu.addAction(self.code_action)
        for dock in self.docks.values():
            view_menu.addAction(dock.toggleViewAction())
        view_menu.addAction(self._action("Restore panels", self._restore_panels))
        view_menu.addAction(self._action("Toggle light/dark widgets", self._toggle_theme))
        tools = self.menuBar().addMenu("&Tools")
        tools.addAction(self._action("Check circuit", self.check_circuit, "Ctrl+Shift+C"))
        tools.addAction(self._action("Compiler settings…", self._compiler_settings))
        tools.addAction(self._action("Check installed toolchain", self._check_compiler))
        tools.addAction(self._action("Install component library…", self._install_library))
        tools.addAction(self._action("Load component plugin…", self._load_plugin))
        simulation = self.menuBar().addMenu("&Simulation")
        simulation.addAction(self._action("Build current source", lambda: self.build_code(False), "Ctrl+B"))
        simulation.addAction(self._action("Build and run current source", self.run_code, "F5"))
        simulation.addAction(self._action("Load successful build", self.load_build))
        simulation.addAction(self._action("Load firmware file…", self.load_firmware))
        simulation.addAction(self._action("Load reference firmware", self.load_reference))
        simulation.addAction(self._action("Start / resume loaded image", self.start_loaded))
        simulation.addAction(self._action("Pause", self.pause_simulation, "F6"))
        simulation.addAction(self._action("Stop", self.stop_simulation, "Shift+F5"))
        simulation.addAction(self._action("Reset loaded image", self.reset_simulation))
        speed_menu = simulation.addMenu("Execution speed")
        speed_group = QActionGroup(self)
        for label, mode in [("Maximum throughput", "maximum"), ("Pace to real time", "realtime")]:
            action = self._action(label, lambda _checked=False, value=mode: self.set_speed(value))
            action.setCheckable(True)
            action.setChecked(mode == self._speed_mode)
            speed_group.addAction(action)
            speed_menu.addAction(action)
        help_menu = self.menuBar().addMenu("&Help")
        help_menu.addAction(self._action("Controls and model limits", self._show_help))
        help_menu.addAction(self._action("About SimuLab Desktop", lambda: QMessageBox.about(self, "SimuLab Desktop", f"SimuLab Desktop {__version__}\nNative Python/Qt circuit studio.\nReal AVR8js and official Espressif WASM in an isolated Node process.\nAll workspaces are local.")))

    def _build_toolbar(self):
        bar = QToolBar("Workspace commands", self)
        bar.setObjectName("workspace-toolbar")
        bar.setMovable(False)
        self.addToolBar(bar)
        brand = QLabel("  SimuLab  ")
        brand.setFont(QFont("Segoe UI", 14, QFont.Weight.Bold))
        bar.addWidget(brand)
        bar.addAction(self._action("New", self.new_project))
        bar.addAction(self._action("Open", self.open_project))
        bar.addAction(self._action("Save", self.save_project))
        bar.addSeparator()
        self.board_combo = QComboBox()
        for label, board in [("Arduino Uno", "uno"), ("Arduino Nano", "nano"), ("Arduino Mega 2560", "mega2560"), ("ESP32-S3", "esp32s3"), ("YD N16R8 compile profile", "yd-n16r8")]:
            self.board_combo.addItem(label, board)
        self.board_combo.setToolTip("Compiler target; the circuit must contain one matching controller")
        self.board_combo.currentIndexChanged.connect(self._board_changed)
        bar.addWidget(self.board_combo)
        self.build_action = self._action("Build", lambda: self.build_code(False))
        self.run_action = self._action("▶ Run code", self.run_code)
        bar.addAction(self.build_action)
        bar.addAction(self.run_action)
        self.start_image_action = self._action("▶ Start image", self.start_loaded)
        self.start_image_action.setVisible(False)
        bar.addAction(self.start_image_action)
        bar.addAction(self._action("Ⅱ Pause", self.pause_simulation))
        bar.addAction(self._action("■ Stop", self.stop_simulation))
        bar.addAction(self._action("↻ Reset", self.reset_simulation))
        bar.addSeparator()
        bar.addAction(self._action("Fit", self.view.fit_circuit))
        self.firmware_label = QLabel("  Source: no firmware")
        self.firmware_label.setObjectName("muted")
        bar.addWidget(self.firmware_label)

    def _read_settings(self):
        try:
            value = json.loads((self.data_dir / "settings.json").read_text(encoding="utf-8"))
            return value if isinstance(value, dict) else {}
        except (ValueError, OSError):
            return {}

    def _restore_layout(self):
        try:
            if self._settings.get("geometry"):
                self.restoreGeometry(QByteArray.fromBase64(self._settings["geometry"].encode("ascii")))
            if self._settings.get("state"):
                self.restoreState(QByteArray.fromBase64(self._settings["state"].encode("ascii")))
            if self._settings.get("splitter"):
                self.splitter.setSizes(self._settings["splitter"])
            self.code.setVisible(self._settings.get("codeVisible", True))
            self.code_action.setChecked(self.code.isVisible())
        except (ValueError, TypeError):
            pass

    def _title(self):
        self.setWindowTitle(f"{'● ' if self.dirty else ''}{self.project['name']} — SimuLab Desktop")
        self.undo_action.setEnabled(self.history.can_undo)
        self.redo_action.setEnabled(self.history.can_redo)

    def _notice(self, message):
        self.statusBar().showMessage(message, 15000)

    def _set_document(self, document, *, dirty, path=None):
        self._cancel_pending()
        self.runtime.invalidate()
        self.runtime_owner = None
        self.runtime_state = "unloaded"
        self._loaded_key = None
        self._last_build = None
        self._start_session = None
        self.document = deepcopy(document)
        self.history.reset(self.project)
        self.file_path = Path(path) if path else None
        self.dirty = dirty
        self._updating = True
        self.code.set_files(self.document["files"], self.document["activeFile"])
        index = self.board_combo.findData(self.document["board"])
        if index >= 0:
            self.board_combo.setCurrentIndex(index)
        self._updating = False
        self.scene.set_project(self.project)
        self.instruments.set_project(self.project)
        self.scene.clear_projection()
        self.firmware_label.setText("  Source: no firmware")
        self.start_image_action.setVisible(False)
        self.state_label.setText("No firmware loaded")
        self.time_label.setText("0.000 s")
        self.output.set_gpio({})
        self.check_circuit(silent=True)
        self._title()
        QTimer.singleShot(0, self.view.fit_circuit)

    def _sync_sources(self):
        self.document["files"] = self.code.files()
        names = {source["name"] for source in self.document["files"]}
        self.document["breakpoints"] = {name: lines for name, lines in self.document.get("breakpoints", {}).items() if name in names}
        self.document["activeFile"] = self.code.active_file()
        self.document["board"] = self.board_combo.currentData() or "uno"

    def _source_changed(self):
        if self._updating:
            return
        self._sync_sources()
        self._cancel_pending()
        self._last_build = None
        if self.runtime_owner == "code":
            self._unload("Source changed — build and run to load current code.")
        self.dirty = True
        self._title()
        self.autosave_timer.start()

    def _board_changed(self):
        if not self._updating:
            self._sync_sources()
            self._cancel_pending()
            self._last_build = None
            if self.runtime_owner == "code":
                self._unload("Compiler target changed.")
            self.dirty = True
            self._title()
            self.autosave_timer.start()

    def _cancel_pending(self):
        self.generation += 1
        self._compile_cancel.set()
        self._start_session = None

    def _unload(self, reason):
        self.runtime.invalidate()
        self.runtime_owner = None
        self.runtime_state = "unloaded"
        self._loaded_key = None
        self.scene.clear_projection()
        self.instruments.set_project(self.project)
        self.state_label.setText("No firmware loaded")
        self.time_label.setText("0.000 s")
        self.firmware_label.setText("  Source: no firmware")
        self.start_image_action.setVisible(False)
        self._notice(reason)

    def commit_project(self, project):
        """@brief Validate and commit one undoable circuit edit, invalidating stale sessions."""
        try:
            project = parse_project(json.dumps(project, allow_nan=False), self.registry)
        except ValueError as error:
            self.scene.set_project(self.project)
            self._error(str(error))
            return
        if project == self.project:
            return
        self._cancel_pending()
        self.document["circuit"] = project
        self.history.commit(project)
        self._last_build = None
        self._unload("Circuit changed — load firmware for the updated circuit.")
        self.scene.set_project(project)
        self.dirty = True
        self.check_circuit(silent=True)
        self._title()
        self.autosave_timer.start()

    def place_component(self, kind, x=None, y=None):
        """@brief Instantiate a registered part through parameters, including plugins."""
        try:
            if x is None or isinstance(x, bool):
                center = self.view.mapToScene(self.view.viewport().rect().center())
                offset = len(self.project["components"]) % 6 * 30
                x, y = center.x() - 100 + offset, center.y() - 110 + offset
            component = self.registry.create(kind, float(x), float(y))
            effective_kind = self.registry.get(kind).get("engineKind", kind)
            had_board = any(self._effective_kind(c) in BOARDS for c in self.project["components"])
            self.commit_project(editing.add_component(self.project, component, self.registry))
            if effective_kind in BOARDS and not had_board:
                starters = json.loads(resource_path("starters.json").read_text(encoding="utf-8"))
                starter = starters.get(effective_kind)
                self._updating = True
                if starter:
                    self.board_combo.setCurrentIndex(self.board_combo.findData(starter["board"]))
                # Preserve nonblank user code; an explicit placement may initialize the blank sketch.
                if starter and all(not f["content"].strip() or f["content"].strip() == new_workspace(self.registry)["files"][0]["content"].strip() for f in self.code.files()):
                    self.code.set_files([{"name": "sketch.ino", "content": starter["content"]}])
                self._sync_sources()
                self._updating = False
            self.scene.select_components([component["id"]])
            self.view.setFocus()
            self._notice(f"Placed {component['label']}")
        except (ValueError, OSError) as error:
            self._error(str(error))

    def _edit_component(self, component):
        project = deepcopy(self.project)
        project["components"] = [component if c["id"] == component["id"] else c for c in project["components"]]
        self.commit_project(project)

    def _selection_changed(self, parts, wires):
        self.selection_label.setText(f"{len(parts)} parts · {len(wires)} wires")
        selected = next((c for c in self.project["components"] if c["id"] == parts[0]), None) if len(parts) == 1 else None
        self.inspector.set_component(selected, len(parts))

    def undo(self):
        if isinstance(QApplication.focusWidget(), QPlainTextEdit) and QApplication.focusWidget() in self.code.editors.values():
            QApplication.focusWidget().undo()
            return
        project = self.history.undo()
        if project is not None:
            self._apply_history(project)

    def redo(self):
        if isinstance(QApplication.focusWidget(), QPlainTextEdit) and QApplication.focusWidget() in self.code.editors.values():
            QApplication.focusWidget().redo()
            return
        project = self.history.redo()
        if project is not None:
            self._apply_history(project)

    def _apply_history(self, project):
        self._cancel_pending()
        self.document["circuit"] = project
        self._last_build = None
        self._unload("History restored — reload firmware for this circuit.")
        self.scene.set_project(project)
        self.dirty = True
        self.check_circuit(silent=True)
        self._title()
        self.autosave_timer.start()

    def _canvas_command(self, command):
        parts, wires = self.scene.selected_components(), self.scene.selected_wires()
        if command == "fit":
            self.view.fit_circuit()
        elif command == "select_all":
            self.scene.select_components(self.scene.parts)
        elif command == "copy":
            self._clipboard = (deepcopy(self.project), list(parts))
            self._notice(f"Copied {len(parts)} parts and their internal wires")
        elif command in {"paste", "duplicate"}:
            if command == "duplicate":
                self._clipboard = (deepcopy(self.project), list(parts))
            if self._clipboard and self._clipboard[1]:
                original, identifiers = self._clipboard
                cloned = editing.clone_components(original, identifiers)
                old_ids = {c["id"] for c in original["components"]}
                old_wires = {w["id"] for w in original["wires"]}
                new_parts = [c for c in cloned["components"] if c["id"] not in old_ids]
                new_wires = [w for w in cloned["wires"] if w["id"] not in old_wires]
                project = deepcopy(self.project)
                project["components"].extend(new_parts)
                project["wires"].extend(new_wires)
                self.commit_project(project)
                self.scene.select_components([c["id"] for c in new_parts])
        elif command == "delete":
            project = editing.delete_components(self.project, parts)
            project = editing.delete_wires(project, wires)
            self.commit_project(project)
        elif command == "rotate":
            project = deepcopy(self.project)
            for component in project["components"]:
                if component["id"] in parts:
                    component["rotation"] = (component["rotation"] + 90) % 360
            self.commit_project(project)
        elif command == "reference":
            self.load_reference()
        elif command == "firmware":
            self.load_firmware()

    def _toggle_device(self, identifier, pressed):
        component = next((c for c in self.project["components"] if c["id"] == identifier), None)
        if not component:
            return
        if self.runtime_owner and self.runtime_state in {"running", "paused", "ready"}:
            self.runtime.send("device", componentId=identifier, properties={"pressed": pressed})
            item = self.scene.parts.get(identifier)
            if item:
                item.component["properties"]["pressed"] = pressed
                item.update()
        else:
            updated = deepcopy(component)
            updated["properties"]["pressed"] = pressed
            self._edit_component(updated)

    def _open_instrument(self, identifier):
        self.docks["instruments"].show()
        self.docks["instruments"].raise_()
        self.instruments.select_instrument(identifier)

    def _instrument_action(self, identifier, action, text):
        if self.runtime_owner:
            self.runtime.send("instrument", componentId=identifier, action=action, text=text)
        else:
            self._notice("Load real firmware before using wired instruments.")

    def check_circuit(self, _checked=False, *, silent=False):
        issues = validate_circuit(self.project, self.registry)
        self.output.set_analysis(issues, build_nets(self.project, self.registry))
        if not silent:
            self.docks["output"].show()
            self.output.setCurrentWidget(self.output.diagnostics)
            self._notice(f"Circuit checked: {len(issues)} structural issue(s)")

    def _confirm_replace(self):
        if not self.dirty:
            return True
        response = QMessageBox.question(self, "Save current workspace?", "Save changes before replacing this workspace?", QMessageBox.StandardButton.Save | QMessageBox.StandardButton.Discard | QMessageBox.StandardButton.Cancel, QMessageBox.StandardButton.Save)
        if response == QMessageBox.StandardButton.Cancel:
            return False
        return self.save_project() if response == QMessageBox.StandardButton.Save else True

    def new_project(self):
        if self._confirm_replace():
            self._set_document(new_workspace(self.registry), dirty=False)
            self._autosave()

    def open_project(self):
        path, _ = QFileDialog.getOpenFileName(self, "Open SimuLab workspace or circuit", str(self.file_path.parent if self.file_path else self.data_dir), "SimuLab JSON (*.json);;All files (*)")
        if path:
            self.open_path(Path(path))

    def open_path(self, path, *, example=False, confirm=True):
        if confirm and not self._confirm_replace():
            return False
        try:
            document = load_document(Path(path), self.registry)
            self._set_document(document, dirty=example, path=None if example else path)
            self._notice("Example circuit opened. Firmware has not been loaded." if example else f"Opened {path}")
            self._autosave()
            return True
        except (ValueError, OSError) as error:
            self._error(str(error))
            return False

    def save_to(self, path):
        """@brief Save a validated portable document atomically and update native ownership."""
        self._sync_sources()
        save_document(Path(path), self.document, self.registry)
        self.file_path = Path(path)
        self.dirty = False
        self._title()
        self._autosave()
        self._notice(f"Saved {path}")
        return True

    def save_project(self, _checked=False, *, save_as=False):
        path = self.file_path
        if save_as or not path:
            chosen, _ = QFileDialog.getSaveFileName(self, "Save portable workspace", str(path or self.data_dir / "project.simulab.json"), "SimuLab workspace (*.json)")
            if not chosen:
                return False
            path = Path(chosen)
        try:
            return self.save_to(path)
        except (ValueError, OSError) as error:
            self._error(str(error))
            return False

    def export_circuit(self):
        path, _ = QFileDialog.getSaveFileName(self, "Export circuit JSON", "circuit.json", "JSON (*.json)")
        if path:
            try:
                portable = parse_project(json.dumps(self.project), self.registry)
                Path(path).write_text(json.dumps(portable, indent=2, ensure_ascii=False), encoding="utf-8")
                custom = [c["kind"] for c in self.project["components"] if self.registry.get(c["kind"]).get("engineKind")]
                self._notice("Circuit exported. Custom plugin kinds require the same plugin in a compatible host." if custom else "Browser-compatible circuit exported.")
            except (ValueError, OSError) as error:
                self._error(str(error))

    def export_image(self):
        path, _ = QFileDialog.getSaveFileName(self, "Export native canvas image", "circuit.png", "PNG (*.png)")
        if path:
            if not self.view.grab().save(path):
                self._error("Canvas image could not be written.")

    def _autosave(self):
        if self._closing:
            return
        try:
            self._sync_sources()
            save_document(self.data_dir / "recovery.simulab.json", self.document, self.registry)
        except (ValueError, OSError) as error:
            self.output.append(f"Autosave: {error}")

    def _target(self):
        controllers = [c for c in self.project["components"] if self._effective_kind(c) in BOARDS]
        if len(controllers) != 1:
            raise ValueError("Execution requires exactly one supported controller in the circuit.")
        return TARGETS[self._effective_kind(controllers[0])]

    def _effective_kind(self, component):
        return self.registry.get(component["kind"]).get("engineKind", component["kind"])

    def _source_key(self):
        self._sync_sources()
        data = {"board": self.document["board"], "files": self.document["files"], "circuit": self.project}
        return hashlib.sha256(json.dumps(data, sort_keys=True, ensure_ascii=False).encode("utf-8")).hexdigest()

    def _load_image(self, image, image_format, owner, label, *, auto_start=False, key=None):
        target = self._target()
        if (target == "esp32s3") != (image_format == "bin"):
            raise ValueError("ESP32-S3 requires a merged flash BIN; AVR controllers require Intel HEX.")
        self._cancel_pending()
        project = self.registry.engine_project(self.project)
        self.runtime_owner = owner
        self._loaded_key = key
        self.runtime_state = "loading"
        self.firmware_label.setText(f"  {owner.title()}: {label}")
        self.start_image_action.setVisible(owner == "manual")
        self.state_label.setText("Loading genuine firmware…")
        self._load_request = self.runtime.load_image(project, target, image, image_format=image_format)
        if self.runtime_state != "error":
            self.runtime.send("speed", mode=self._speed_mode)
        self._start_session = self.runtime.session if auto_start and self.runtime_state != "error" else None
        self.output.append(f"Loading {label} for {target} ({len(image):,} bytes), session {self.runtime.session}")

    def load_reference(self):
        try:
            target = self._target()
            name = "esp32s3-reference.bin" if target == "esp32s3" else "mega2560.hex" if target == "mega2560" else "blink-uart.hex"
            self._load_image(resource_path("firmware", name).read_bytes(), "bin" if target == "esp32s3" else "hex", "manual", f"Reference {name}")
            self._notice("Reference image loaded explicitly. Use Start loaded image from Simulation to execute it.")
        except (ValueError, OSError) as error:
            self._error(str(error))

    def load_firmware(self):
        try:
            target = self._target()
            path, _ = QFileDialog.getOpenFileName(self, "Load compiled firmware into simulator", "", "Merged S3 flash (*.bin)" if target == "esp32s3" else "Intel HEX (*.hex)")
            if path:
                file = Path(path)
                if file.stat().st_size > (16 * 1024 * 1024 if target == "esp32s3" else 1048576):
                    raise ValueError("Firmware image exceeds target bounds.")
                self._load_image(file.read_bytes(), file.suffix[1:].lower(), "manual", file.name)
        except (ValueError, OSError) as error:
            self._error(str(error))

    def start_loaded(self):
        if self.runtime_owner:
            self.runtime.send("resume" if self.runtime_state == "paused" else "start")
        else:
            self._notice("Load compiled/reference firmware first, or Run code to compile your source.")

    def set_speed(self, mode):
        """@brief Select bounded maximum throughput or actual emulated-time pacing."""
        if mode not in {"maximum", "realtime"}:
            raise ValueError("Unsupported simulation speed mode.")
        self._speed_mode = mode
        if self.runtime_owner:
            self.runtime.send("speed", mode=mode)
        self._notice("Maximum MCU throughput selected." if mode == "maximum" else "MCU execution paced to real time when the host can keep up.")

    def pause_simulation(self):
        if self.runtime_owner:
            self.runtime.send("pause")

    def stop_simulation(self):
        self._cancel_pending()
        if self.runtime_owner:
            self.runtime.send("stop")
        self.scene.clear_projection()
        if self._busy:
            self._notice("Build cancellation requested. Any late result will be discarded.")

    def reset_simulation(self):
        self._cancel_pending()
        if self.runtime_owner:
            self.runtime.send("reset")

    def _runtime_message(self, reply):
        if reply.get("type") == "instrument-error":
            self.output.append(reply.get("message", "Instrument request rejected."))
            return
        if reply.get("type") != "snapshot":
            return
        snapshot = reply.get("snapshot", {})
        projection = reply.get("projection", {})
        self.runtime_state = snapshot.get("state", "ready")
        self.start_image_action.setText("▶ Resume image" if self.runtime_state == "paused" else "▶ Start image")
        self.state_label.setText(self.runtime_state.capitalize())
        self.time_label.setText(f"{snapshot.get('timeMicros', 0) / 1e6:.3f} s")
        self.scene.apply_projection(projection)
        if self.runtime_state == "stopped":
            self.scene.clear_projection()
        if self.docks["inspector"].isVisible():
            self.inspector.apply_state(projection)
        if self.docks["output"].isVisible() and self.output.currentWidget() is self.output.gpio:
            self.output.set_gpio(snapshot.get("gpio", {}))
        self.instruments.set_states(projection.get("instruments", {}))
        if reply.get("id") == self._load_request and self._start_session == self.runtime.session:
            self._start_session = None
            self.runtime.send("start")

    def _runtime_error(self, message):
        self._start_session = None
        if self.runtime_state == "loading":
            self.runtime_owner = None
            self._loaded_key = None
            self.firmware_label.setText("  Firmware load failed")
        self.runtime_state = "error"
        self.state_label.setText("Execution error")
        self.output.append("ENGINE: " + message)
        self._notice(message)

    def _get_compiler(self):
        # Only worker threads wait on startup. Closing the window never waits on this lock.
        with self._compiler_lock:
            if self._closing:
                raise RuntimeError("Application closed before compiler startup.")
            if self._compiler is None:
                from ..services.compiler_host import LocalCompiler
                options = self._settings.get("compiler", {})
                self._compiler = LocalCompiler(cache_dir=self.data_dir / "compiler", node_executable=options.get("node") or None, cli_executable=options.get("cli") or None, config_file=options.get("config") or None)
            if hasattr(self._compiler, "start"):
                self._compiler.start()
            if self._closing:
                self._compiler.close()
                raise RuntimeError("Application closed during compiler startup; owned compiler stopped.")
            return self._compiler

    def _task(self, operation, result, *, progress=None, error=None):
        task = BackgroundTask(operation)
        self._tasks.add(task)
        task.signals.result.connect(lambda value: result(value) if not self._closing else None)
        task.signals.error.connect(lambda message: (error or self._error)(message) if not self._closing else None)
        if progress:
            task.signals.progress.connect(progress)
        task.signals.finished.connect(lambda: self._tasks.discard(task))
        self.thread_pool.start(task)
        return task

    def build_code(self, run=False):
        """@brief Compile current source asynchronously and reject stale or mismatched results."""
        if self._busy:
            self._notice("A build is already active. Stop cancels its pending result.")
            return
        try:
            target = self._target()
            board = self.board_combo.currentData()
            if ("esp32s3" if board == "yd-n16r8" else board) != target:
                raise ValueError("Compiler profile must match the circuit's single controller.")
            key = self._source_key()
            files = deepcopy(self.document["files"])
        except ValueError as error:
            self._error(str(error))
            return
        self._cancel_pending()
        generation = self.generation
        self._compile_cancel = threading.Event()
        cancellation = self._compile_cancel
        self._busy = True
        self.build_action.setEnabled(False)
        self.run_action.setEnabled(False)
        self.progress.setRange(0, 0)
        self.progress.setFormat("Preparing compiler…")
        self.progress.show()
        self.docks["output"].show()
        self.docks["output"].raise_()
        self.resizeDocks([self.docks["output"]], [160], Qt.Orientation.Vertical)
        self.output.setCurrentWidget(self.output.log)
        self.output.append(f"Building current {board} source; real compiler telemetry follows.")

        def compile_current(progress):
            compiler = self._get_compiler()
            result = compiler.compile(board, files, on_progress=progress, cancel_event=cancellation)
            image = None
            image_format = "bin" if target == "esp32s3" else "hex"
            if result.get("success"):
                names = result.get("artifacts", [])
                chosen = next((name for name in names if name.endswith(".merged.bin")), None) if target == "esp32s3" else next((name for name in names if name.endswith(".hex") and "with_bootloader" not in name), None)
                if not chosen:
                    raise ValueError("Compiler did not return target-compatible HEX / merged S3 BIN firmware.")
                image = compiler.fetch_artifact({"job": result["job"], "name": chosen})
            return {"result": result, "image": image, "format": image_format, "key": key, "generation": generation, "run": run}

        self._task(compile_current, self._compiled, progress=self._build_progress, error=lambda message: self._build_failed(message, generation))

    def run_code(self):
        if self.runtime_owner == "code" and self._loaded_key == self._source_key():
            if self.runtime_state == "running":
                self._notice("Current code is already running.")
            else:
                self.start_loaded()
            return
        self.build_code(True)

    def _build_progress(self, progress):
        if self._compile_cancel.is_set():
            return
        value = progress.get("percent", progress.get("percentage"))
        stage = progress.get("stage", progress.get("phase", "Compiling"))
        if isinstance(value, (int, float)):
            self.progress.setRange(0, 100)
            self.progress.setValue(round(value))
            self.progress.setFormat(f"{stage} · %p%")
        else:
            self.progress.setRange(0, 0)
            self.progress.setFormat(str(stage))
        elapsed = progress.get("elapsedMs")
        self._notice(f"{stage}" + (f" · {elapsed / 1000:.1f} s" if isinstance(elapsed, (int, float)) else ""))

    def _finish_build(self):
        self._busy = False
        self.build_action.setEnabled(True)
        self.run_action.setEnabled(True)
        self.progress.hide()

    def _compiled(self, build):
        self._finish_build()
        if build["generation"] != self.generation or self._compile_cancel.is_set() or build["key"] != self._source_key():
            self.output.append("Discarded a build whose source, circuit, target or session changed.")
            return
        result = build["result"]
        self.output.append(result.get("log", ""))
        if not result.get("success"):
            self._notice("Compiler reported errors; see Build / events.")
            return
        self._last_build = build
        self.output.append(f"Build succeeded ({'verified compiler cache' if result.get('cached') else 'compiled'}), {result.get('durationMs', 0) / 1000:.2f} s.")
        if build["run"]:
            self._load_build(build, auto_start=True)
        else:
            self._notice("Build succeeded. Load successful build or Run code to execute it.")

    def _build_failed(self, message, generation):
        self._finish_build()
        self.output.append("BUILD: " + message)
        if generation == self.generation:
            self._notice(message)

    def _load_build(self, build, *, auto_start=False):
        try:
            if build["key"] != self._source_key():
                raise ValueError("Source or circuit changed after this build; rebuild current code.")
            self._load_image(build["image"], build["format"], "code", "compiled current source", auto_start=auto_start, key=build["key"])
        except ValueError as error:
            self._error(str(error))

    def load_build(self):
        if self._last_build:
            self._load_build(self._last_build)
        else:
            self._notice("Build current source successfully before loading it.")

    def _check_compiler(self):
        self._task(lambda _progress: self._get_compiler().status(), lambda status: self._show_compiler_status(status))

    def _show_compiler_status(self, status):
        self.output.append("Toolchain: " + json.dumps(status, indent=2))
        self.docks["output"].show()
        self.output.setCurrentWidget(self.output.log)
        self._notice("Installed toolchain is available." if status.get("available") else status.get("message", "Arduino CLI is unavailable; configure its installed path."))

    def _compiler_settings(self):
        if self._busy or self._tasks:
            self._notice("Wait for or stop the current build before changing compiler settings.")
            return
        dialog = QDialog(self)
        dialog.setWindowTitle("Installed local compiler")
        layout = QVBoxLayout(dialog)
        text = QLabel("Use an existing Arduino CLI installation and its installed board cores. Blank paths use environment/PATH discovery.")
        text.setWordWrap(True)
        layout.addWidget(text)
        form = QFormLayout()
        fields = {}
        options = self._settings.get("compiler", {})
        for key, title in [("node", "Node executable"), ("cli", "Arduino CLI"), ("config", "Arduino YAML config")]:
            field = QLineEdit(options.get(key, ""))
            fields[key] = field
            form.addRow(title, field)
        layout.addLayout(form)
        buttons = QDialogButtonBox(QDialogButtonBox.StandardButton.Save | QDialogButtonBox.StandardButton.Cancel)
        buttons.accepted.connect(dialog.accept)
        buttons.rejected.connect(dialog.reject)
        layout.addWidget(buttons)
        if dialog.exec() == QDialog.DialogCode.Accepted:
            if self._compiler and hasattr(self._compiler, "close"):
                self._compiler.close()
            self._compiler = None
            self._settings["compiler"] = {key: value.text().strip() for key, value in fields.items()}
            self._last_build = None
            self._notice("Compiler paths updated. Check installed toolchain from Tools.")

    def _install_library(self):
        if self._busy:
            self._notice("A compiler operation is already active.")
            return
        name, accepted = QInputDialog.getItem(self, "Install component library", "Choose an Arduino library", ["RTClib", "Adafruit NeoPixel", "FastLED"], 0, False)
        if accepted:
            self._task(lambda _progress: self._get_compiler().install_library(name), lambda result: self.output.append(json.dumps(result, indent=2)))

    def _load_plugin(self):
        path, _ = QFileDialog.getOpenFileName(self, "Load a trusted local component plugin", "", "Python component plugin (*.py)")
        if path:
            try:
                self.registry.load_plugins([path])
                self.library.refresh()
                self._notice(f"Component plugin loaded: {Path(path).name}")
            except (ValueError, OSError) as error:
                self._error(str(error))

    def _toggle_code(self):
        self.code.setVisible(self.code_action.isChecked())

    def _restore_panels(self):
        for dock in self.docks.values():
            dock.show()
        self.code.show()
        self.code_action.setChecked(True)
        self.splitter.setSizes([920, 470])

    def _toggle_theme(self):
        light = not self._settings.get("lightTheme", False)
        self._settings["lightTheme"] = light
        apply_theme(QApplication.instance(), light=light)

    def _show_help(self):
        QMessageBox.information(self, "Controls and model limits", "Place parts from Components. Click two named pins to wire; crossing wires do not connect. Double-click a wire for a real junction. Drag a rectangle for group selection; Ctrl+C/V/D, Delete and the context menu edit Hardware. Wheel zooms; Space or middle-drag pans.\n\nBuild/Run code compiles your current source. Reference/manual images are loaded explicitly from Simulation or the controller context menu. Start loaded image executes those images. Wire Serial Monitor RX→D1, TX→D0, GND for AVR; use virtual CONSOLE on S3. Debugger uses virtual DEBUG.\n\nReal AVR / official S3 instruction engines run in a local Node process. Device models retain browser limits: bounded DC, no full SPICE, unsupported ADC/SPI/EEPROM, S3 RMT/I2C attachment and source-level debugging. Robot motion is educational. Software simulation does not verify physical boards. See README and docs/ARCHITECTURE.md.")

    def _error(self, message):
        if not self._closing:
            self.output.append("ERROR: " + message)
            self._notice(message)

    def closeEvent(self, event):
        if self._busy:
            self._cancel_pending()
        # Recovery is retained even when a file-save prompt is declined.
        self._autosave()
        if self.dirty and self.isVisible() and not self._confirm_replace():
            event.ignore()
            return
        self._closing = True
        self.autosave_timer.stop()
        self._cancel_pending()
        self.runtime.close()
        if self._compiler_lock.acquire(blocking=False):
            try:
                if self._compiler and hasattr(self._compiler, "close"):
                    self._compiler.close()
            finally:
                self._compiler_lock.release()
        # An in-progress startup observes _closing under the lock and closes itself.
        self._settings.update(geometry=bytes(self.saveGeometry().toBase64()).decode("ascii"), state=bytes(self.saveState().toBase64()).decode("ascii"), splitter=self.splitter.sizes(), codeVisible=not self.code.isHidden())
        try:
            destination = self.data_dir / "settings.json"
            temporary = destination.with_suffix(".tmp")
            temporary.write_text(json.dumps(self._settings, indent=2), encoding="utf-8")
            temporary.replace(destination)
        except OSError:
            pass
        event.accept()

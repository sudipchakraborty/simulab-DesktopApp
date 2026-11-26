"""@brief Parameterized native library, properties, diagnostics and wired instruments."""

from __future__ import annotations

from copy import deepcopy
import json

from PySide6.QtCore import QMimeData, Qt, Signal
from PySide6.QtGui import QDrag, QFont
from PySide6.QtWidgets import QCheckBox, QComboBox, QDoubleSpinBox, QFormLayout, QHBoxLayout, QLabel, QLineEdit, QPlainTextEdit, QPushButton, QScrollArea, QTabWidget, QTableWidget, QTableWidgetItem, QTreeWidget, QTreeWidgetItem, QVBoxLayout, QWidget


class ComponentTree(QTreeWidget):
    """@brief Drag only a component kind; instances are created by the receiving host."""

    def startDrag(self, _actions):
        item = self.currentItem()
        kind = item.data(0, Qt.ItemDataRole.UserRole) if item else None
        if kind:
            mime = QMimeData()
            mime.setData("application/x-simulab-component", kind.encode("utf-8"))
            drag = QDrag(self)
            drag.setMimeData(mime)
            drag.exec(Qt.DropAction.CopyAction)


class LibraryPanel(QWidget):
    """@brief Search a host-injected registry; double-click or drag to instantiate."""

    place_requested = Signal(str)

    def __init__(self, registry, parent=None):
        super().__init__(parent)
        self.registry = registry
        layout = QVBoxLayout(self)
        layout.setContentsMargins(9, 9, 9, 9)
        self.search = QLineEdit()
        self.search.setPlaceholderText("Search 33 components…")
        self.search.setClearButtonEnabled(True)
        self.search.textChanged.connect(self._filter)
        layout.addWidget(self.search)
        self.tree = ComponentTree()
        self.tree.setHeaderHidden(True)
        self.tree.setDragEnabled(True)
        self.tree.setIndentation(14)
        self.tree.itemDoubleClicked.connect(self._place)
        layout.addWidget(self.tree)
        help_text = QLabel("Double-click or drag onto Hardware.\nClick two named pins to wire.\nDouble-click a switch to toggle it.")
        help_text.setWordWrap(True)
        help_text.setObjectName("muted")
        layout.addWidget(help_text)
        self._rows: dict[str, QTreeWidgetItem] = {}
        self.refresh()

    def refresh(self):
        self.tree.clear()
        self._rows.clear()
        groups = {}
        order = {name: index for index, name in enumerate(["Microcontroller", "Connection", "Sensor", "Actuator", "Module", "Robotics", "Meter", "Instrument"])}
        definitions = sorted(self.registry.definitions.items(), key=lambda item: (order.get(item[1].get("category"), 99), item[1]["name"].casefold()))
        for kind, definition in definitions:
            category = definition.get("category", "Plugin")
            if category not in groups:
                group = QTreeWidgetItem([category.upper()])
                group.setFlags(Qt.ItemFlag.ItemIsEnabled)
                self.tree.addTopLevelItem(group)
                groups[category] = group
            row = QTreeWidgetItem([definition["name"]])
            row.setData(0, Qt.ItemDataRole.UserRole, kind)
            row.setToolTip(0, definition.get("description", kind))
            groups[category].addChild(row)
            self._rows[kind] = row
        self.tree.expandAll()
        self.search.setPlaceholderText(f"Search {len(self._rows)} components…")
        self._filter(self.search.text())

    def _filter(self, text):
        terms = text.strip().casefold().split()
        primary = set()
        for kind in self._rows:
            definition = self.registry.get(kind)
            name = f"{kind} {definition['name']}".casefold()
            if all(term in name for term in terms):
                primary.add(kind)
        for kind, row in self._rows.items():
            definition = self.registry.get(kind)
            haystack = f"{kind} {definition['name']} {definition.get('description', '')}".casefold()
            row.setHidden(kind not in primary if primary else not all(term in haystack for term in terms))
        for index in range(self.tree.topLevelItemCount()):
            group = self.tree.topLevelItem(index)
            group.setHidden(all(group.child(j).isHidden() for j in range(group.childCount())))

    def visible_kinds(self):
        return [kind for kind, row in self._rows.items() if not row.isHidden()]

    def _place(self, item, _column):
        kind = item.data(0, Qt.ItemDataRole.UserRole)
        if kind:
            self.place_requested.emit(kind)


class InspectorPanel(QWidget):
    """@brief Edit detached component data and expose genuine runtime values."""

    component_edited = Signal(dict)

    def __init__(self, registry, parent=None):
        super().__init__(parent)
        self.registry = registry
        self.component = None
        self.fields = {}
        layout = QVBoxLayout(self)
        self.description = QLabel("Select a component to inspect its parameters.")
        self.description.setWordWrap(True)
        self.description.setObjectName("muted")
        layout.addWidget(self.description)
        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        self.form_host = QWidget()
        self.form = QFormLayout(self.form_host)
        self.form.setFieldGrowthPolicy(QFormLayout.FieldGrowthPolicy.AllNonFixedFieldsGrow)
        scroll.setWidget(self.form_host)
        layout.addWidget(scroll, 1)
        self.apply_button = QPushButton("Apply parameters")
        self.apply_button.clicked.connect(self.apply)
        layout.addWidget(self.apply_button)
        self.live = QPlainTextEdit()
        self.live.setReadOnly(True)
        self.live.setMaximumHeight(170)
        self.live.setPlaceholderText("Live device values appear during firmware execution.")
        self.live.setFont(QFont("Consolas", 9))
        layout.addWidget(self.live)

    def set_component(self, component: dict | None, count=0):
        self.component = deepcopy(component)
        self.fields = {}
        while self.form.rowCount():
            self.form.removeRow(0)
        self.live.clear()
        self.apply_button.setEnabled(component is not None)
        if not component:
            self.description.setText(f"{count} components selected. Drag any selected part to move the group." if count else "Select a component to inspect its parameters.")
            return
        definition = self.registry.get(component["kind"])
        self.description.setText(definition.get("description", component["kind"]))
        values = {"label": component["label"], "rotation": component["rotation"], **component.get("properties", {})}
        for key, value in values.items():
            if key == "rotation":
                field = QComboBox()
                field.addItems(["0", "90", "180", "270"])
                field.setCurrentText(str(value))
            elif isinstance(value, bool):
                field = QCheckBox()
                field.setChecked(value)
            elif isinstance(value, (int, float)):
                field = QDoubleSpinBox()
                field.setRange(-1e12, 1e12)
                field.setDecimals(5 if isinstance(value, float) else 0)
                field.setValue(value)
                field.setKeyboardTracking(False)
            else:
                field = QLineEdit(str(value))
                field.setMaxLength(200 if key == "label" else 1000)
            self.fields[key] = field
            self.form.addRow(key, field)
        position = component["position"]
        self.form.addRow("Position", QLabel(f"{position['x']:.0f}, {position['y']:.0f}"))

    def apply(self):
        """@brief Emit a complete edited component; host validation remains authoritative."""
        if not self.component:
            return
        component = deepcopy(self.component)
        for key, field in self.fields.items():
            if isinstance(field, QCheckBox):
                value = field.isChecked()
            elif isinstance(field, QDoubleSpinBox):
                value = field.value()
            elif isinstance(field, QComboBox):
                value = int(field.currentText())
            else:
                value = field.text()
            if key in {"label", "rotation"}:
                component[key] = value
            else:
                original = component["properties"].get(key)
                component["properties"][key] = int(value) if isinstance(original, int) and not isinstance(original, bool) else value
        self.component_edited.emit(component)

    def apply_state(self, projection):
        if self.component:
            state = projection.get("components", {}).get(self.component["id"], {})
            self.live.setPlainText(json.dumps(state, indent=2) if state else "No behavioral values for this part.")


class OutputPanel(QTabWidget):
    """@brief Structural diagnostics, explicit nets, MCU GPIO and compiler logs."""

    def __init__(self, parent=None):
        super().__init__(parent)
        self.log = QPlainTextEdit()
        self.log.setReadOnly(True)
        self.log.setMaximumBlockCount(5000)
        self.log.setFont(QFont("Consolas", 9))
        self.diagnostics = QPlainTextEdit()
        self.diagnostics.setReadOnly(True)
        self.nets = QPlainTextEdit()
        self.nets.setReadOnly(True)
        self.gpio = QTableWidget(0, 2)
        self.gpio.setHorizontalHeaderLabels(["MCU pin", "Level"])
        self.gpio.horizontalHeader().setStretchLastSection(True)
        self.gpio.verticalHeader().setVisible(False)
        for widget, title in [(self.log, "Build / events"), (self.diagnostics, "Circuit checks"), (self.nets, "Nets"), (self.gpio, "GPIO")]:
            self.addTab(widget, title)

    def append(self, message: str):
        self.log.appendPlainText(message)

    def set_analysis(self, issues, nets):
        self.diagnostics.setPlainText("\n".join(f"{issue.get('severity', 'info').upper()}: {issue.get('message', issue)}" for issue in issues) or "No structural connectivity issues. Full analog SPICE is unavailable.")
        self.nets.setPlainText("\n".join(f"{net['id']}: " + " / ".join(f"{e['componentId']}.{e['pinId']}" for e in net["endpoints"]) for net in nets))

    def set_gpio(self, gpio):
        rows = list(gpio.items())
        self.gpio.setRowCount(len(rows))
        for row, (pin, value) in enumerate(rows):
            self.gpio.setItem(row, 0, QTableWidgetItem(pin))
            self.gpio.setItem(row, 1, QTableWidgetItem("HIGH" if value == 1 else "LOW" if value == 0 else "Floating / unsupported"))


class InstrumentPanel(QWidget):
    """@brief Explicitly wired terminal/debugger view, parameterized by host state."""

    action_requested = Signal(str, str, str)

    def __init__(self, parent=None, *, registry=None):
        super().__init__(parent)
        self.registry = registry
        self._states = {}
        self._parts = {}
        self.select = QComboBox()
        self.select.currentIndexChanged.connect(self.refresh)
        self.connection = QLabel("Add a Serial Monitor or Debugger from the library and wire it to the controller.")
        self.connection.setWordWrap(True)
        self.connection.setObjectName("muted")
        self.console = QPlainTextEdit()
        self.console.setReadOnly(True)
        self.console.setFont(QFont("Consolas", 10))
        self.input = QLineEdit()
        self.input.setPlaceholderText("Firmware UART / S3 guest console input")
        self.input.setMaxLength(4000)
        self.input.returnPressed.connect(self._send)
        send = QPushButton("Send")
        send.clicked.connect(self._send)
        row = QHBoxLayout()
        row.addWidget(self.input, 1)
        row.addWidget(send)
        controls = QHBoxLayout()
        self.buttons = {}
        for label, action in [("Pause", "pause"), ("Continue", "resume"), ("Step instruction", "step"), ("Reset", "reset"), ("Clear", "clear")]:
            button = QPushButton(label)
            button.clicked.connect(lambda _checked=False, value=action: self._action(value))
            controls.addWidget(button)
            self.buttons[action] = button
        layout = QVBoxLayout(self)
        layout.addWidget(self.select)
        layout.addWidget(self.connection)
        layout.addWidget(self.console, 1)
        layout.addLayout(row)
        layout.addLayout(controls)

    def set_project(self, project):
        prior = self.select.currentData()
        self.select.blockSignals(True)
        self.select.clear()
        self._parts = {c["id"]: c for c in project["components"] if self._kind(c) in {"serial-monitor", "debugger"}}
        for identifier, component in self._parts.items():
            self.select.addItem(component["label"], identifier)
        index = self.select.findData(prior)
        if index >= 0:
            self.select.setCurrentIndex(index)
        self.select.blockSignals(False)
        self._states = {}
        self.console.clear()
        self.refresh()

    def set_states(self, states):
        self._states = states or {}
        self.refresh()

    def select_instrument(self, identifier):
        index = self.select.findData(identifier)
        if index >= 0:
            self.select.setCurrentIndex(index)

    def refresh(self, *_args):
        identifier = self.select.currentData()
        part = self._parts.get(identifier)
        state = self._states.get(identifier, {})
        connection = state.get("connection", {})
        issues = connection.get("issues", [])
        self.connection.setText(state.get("error") or "; ".join(issues) or ("Connected to real firmware" if connection.get("receive") or connection.get("debug") else "Wire RX→D1, TX→D0, GND for AVR; CONSOLE→CONSOLE for S3. Debugger uses DEBUG→DEBUG."))
        if part and self._kind(part) == "debugger":
            debug = state.get("debug")
            text = json.dumps(debug, indent=2) if debug else "AVR instruction registers need a wired DEBUG connection. Source stepping and ESP32 instruction debugging are unavailable."
        else:
            text = state.get("log", "")
        if self.console.toPlainText() != text:
            self.console.setPlainText(text)
            self.console.verticalScrollBar().setValue(self.console.verticalScrollBar().maximum())
        self.input.setEnabled(bool(connection.get("transmit")))
        for action, button in self.buttons.items():
            button.setEnabled(bool(identifier) and (action == "clear" or bool(connection.get("debug"))) and not (action == "step" and connection.get("target") == "esp32s3"))

    def _send(self):
        self._action("send", self.input.text())
        self.input.clear()

    def _kind(self, component):
        return self.registry.get(component["kind"]).get("engineKind", component["kind"]) if self.registry else component["kind"]

    def _action(self, action, text=""):
        identifier = self.select.currentData()
        if identifier:
            self.action_requested.emit(identifier, action, text)

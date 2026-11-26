"""@brief Native scene graph with explicit pin wiring and incremental live state.
@details Coordinates affect artwork only. Electrical connections always use pin IDs.
"""

from __future__ import annotations

from copy import deepcopy
import math

from PySide6.QtCore import QLineF, QPoint, QPointF, QRectF, Qt, Signal
from PySide6.QtGui import QColor, QFont, QPainter, QPainterPath, QPen, QBrush, QPolygonF
from PySide6.QtWidgets import QGraphicsEllipseItem, QGraphicsItem, QGraphicsPathItem, QGraphicsScene, QGraphicsSimpleTextItem, QGraphicsView, QMenu

from ..core import editing
from .theme import COLORS

BOARDS = {"uno", "nano", "mega2560", "yd-esp32-s3"}


class PinItem(QGraphicsEllipseItem):
    """@brief Identified clickable terminal; labels and live level remain separate."""

    def __init__(self, component: dict, definition: dict, parent: QGraphicsItem):
        super().__init__(-5, -5, 10, 10, parent)
        self.endpoint = {"componentId": component["id"], "pinId": definition["id"]}
        self.definition = definition
        self.setPen(QPen(QColor("#8ca4b6"), 1.4))
        self.setBrush(QColor("#14202b"))
        self.setZValue(6)
        self.setCursor(Qt.CursorShape.CrossCursor)
        self.setAcceptHoverEvents(True)
        self._last_level = None
        self.setToolTip(f"{component['label']} · {definition.get('label', definition['id'])}\n{definition.get('electricalType', 'passive')}\nClick two pins to connect; Escape cancels.")

    def mousePressEvent(self, event):
        if event.button() == Qt.MouseButton.LeftButton:
            self.scene().pin_clicked(self.endpoint, self.scenePos())
            event.accept()
        else:
            super().mousePressEvent(event)

    def hoverEnterEvent(self, event):
        self.setScale(1.45)
        super().hoverEnterEvent(event)

    def hoverLeaveEvent(self, event):
        self.setScale(1)
        super().hoverLeaveEvent(event)

    def set_level(self, level):
        if level == self._last_level:
            return
        self._last_level = level
        if level in (1, "high", "HIGH"):
            color = "#44d7b6"
        elif level in (0, "low", "LOW"):
            color = "#607383"
        else:
            color = "#14202b"
        self.setBrush(QColor(color))


class ComponentItem(QGraphicsItem):
    """@brief Parameterized native part renderer with replaceable catalogue data."""

    def __init__(self, component: dict, definition: dict, scene: "CircuitScene"):
        super().__init__()
        self.component = deepcopy(component)
        self.definition = definition
        self.render_kind = definition.get("engineKind", component["kind"])
        self.host_scene = scene
        self.state: dict = {}
        self.lit = False
        self.pins: dict[str, PinItem] = {}
        count = len(definition.get("pins", []))
        self.width = 240 if self.render_kind in BOARDS else 174
        self.height = max(128, 70 + math.ceil(count / 2) * 22)
        if self.render_kind == "junction":
            self.width, self.height = 48, 48
        self.setFlags(QGraphicsItem.GraphicsItemFlag.ItemIsMovable | QGraphicsItem.GraphicsItemFlag.ItemIsSelectable | QGraphicsItem.GraphicsItemFlag.ItemSendsGeometryChanges)
        self.setCacheMode(QGraphicsItem.CacheMode.DeviceCoordinateCache)
        self.setTransformOriginPoint(self.width / 2, self.height / 2)
        if self.render_kind == "junction":
            self.setTransformOriginPoint(0, 0)
        self.setToolTip(definition.get("description", ""))
        self._create_pins()
        self.setPos(component["position"]["x"], component["position"]["y"])
        self.setRotation(component.get("rotation", 0))

    def _create_pins(self):
        pins = self.definition.get("pins", [])
        midpoint = math.ceil(len(pins) / 2)
        for index, definition in enumerate(pins):
            pin = PinItem(self.component, definition, self)
            self.pins[definition["id"]] = pin
            if self.render_kind == "junction":
                pin.setPos(0, 0)
                continue
            left = index < midpoint
            row = index if left else index - midpoint
            pin.setPos(0 if left else self.width, 58 + row * 22)
            label = QGraphicsSimpleTextItem(definition.get("label", definition["id"]), self)
            label.setBrush(QColor("#b8cddd"))
            label.setFont(QFont("Consolas", 8))
            label.setPos(12 if left else self.width - label.boundingRect().width() - 12, 50 + row * 22)
            label.setAcceptedMouseButtons(Qt.MouseButton.NoButton)

    def boundingRect(self):
        if self.render_kind == "junction":
            return QRectF(-10, -10, 20, 20)
        return QRectF(-8, -8, self.width + 16, self.height + 16)

    def paint(self, painter, _option, _widget=None):
        kind = self.render_kind
        selected = self.isSelected()
        painter.setRenderHint(QPainter.RenderHint.Antialiasing)
        painter.setPen(QPen(QColor(COLORS["accent"] if selected else "#425a6b"), 2.4 if selected else 1.2))
        painter.setBrush(QColor("#143d42" if kind in BOARDS else "#1d2c3a"))
        if kind == "junction":
            painter.setBrush(QColor("#44d7b6"))
            painter.drawEllipse(QPointF(0, 0), 7, 7)
            return
        painter.drawRoundedRect(QRectF(0, 0, self.width, self.height), 10, 10)
        painter.setPen(QColor("#f0f7fb"))
        painter.setFont(QFont("Segoe UI", 10, QFont.Weight.DemiBold))
        label = self.component.get("label", self.definition.get("name", kind))
        if len(label) > (28 if kind in BOARDS else 19):
            label = label[:25 if kind in BOARDS else 17] + "…"
        painter.drawText(QRectF(12, 11, self.width - 24, 25), Qt.AlignmentFlag.AlignLeft, label)
        painter.setPen(QPen(QColor("#35505f"), 1))
        painter.drawLine(QPointF(12, 42), QPointF(self.width - 12, 42))
        cx, cy = self.width / 2, max(85, self.height / 2 + 12)
        self._paint_symbol(painter, kind, cx, cy)
        values = self.state.get("values", {})
        if values and self.height > 135:
            text = " · ".join(f"{k}: {v:.3g}" if isinstance(v, float) else f"{k}: {v}" for k, v in list(values.items())[:2])
            painter.setFont(QFont("Consolas", 8))
            painter.setPen(QColor("#7ee2cb"))
            painter.drawText(QRectF(10, self.height - 23, self.width - 20, 18), Qt.AlignmentFlag.AlignCenter, text[:36])

    def _paint_symbol(self, painter, kind, x, y):
        painter.setPen(QPen(QColor("#7caab6"), 2))
        painter.setBrush(Qt.BrushStyle.NoBrush)
        if kind in BOARDS:
            painter.setBrush(QColor("#10282e"))
            painter.drawRoundedRect(QRectF(x - 30, y - 38, 60, 70), 4, 4)
            for offset in range(-25, 30, 10):
                painter.drawLine(QPointF(x - 38, y + offset), QPointF(x - 30, y + offset))
                painter.drawLine(QPointF(x + 30, y + offset), QPointF(x + 38, y + offset))
            painter.setPen(QColor("#88c7c8"))
            painter.setFont(QFont("Consolas", 8))
            chip = "XTENSA\nESP32-S3" if kind == "yd-esp32-s3" else "AVR\n2560" if kind == "mega2560" else "AVR\n328P"
            painter.drawText(QRectF(x - 30, y - 32, 60, 60), Qt.AlignmentFlag.AlignCenter, chip)
            painter.setBrush(QColor("#44d7b6" if self.lit else "#325151"))
            painter.drawEllipse(QPointF(x, y + 49), 4, 4)
        elif kind in {"led", "ir-emitter"}:
            color = QColor(self.component.get("properties", {}).get("color", "#fa786f"))
            painter.setPen(QPen(color, 2))
            painter.setBrush(color if self.lit else QColor("#3b3038"))
            painter.drawEllipse(QPointF(x, y), 20, 20)
            if self.lit:
                painter.setPen(QPen(color.lighter(), 1, Qt.PenStyle.DotLine))
                painter.drawEllipse(QPointF(x, y), 26, 26)
        elif kind == "resistor":
            path = QPainterPath(QPointF(x - 35, y))
            for index, dy in enumerate([0, -10, 10, -10, 10, -10, 10, 0]):
                path.lineTo(x - 35 + index * 10, y + dy)
            painter.drawPath(path)
            painter.setFont(QFont("Consolas", 9))
            painter.drawText(QRectF(x - 55, y + 15, 110, 22), Qt.AlignmentFlag.AlignCenter, f"{self.component.get('properties', {}).get('resistanceOhms', 220):g} Ω")
        elif kind in {"switch", "tactile-switch", "electromagnetic-switch", "relay"}:
            pressed = self.component.get("properties", {}).get("pressed", False) or self.state.get("values", {}).get("energized", False)
            painter.drawEllipse(QPointF(x - 25, y), 4, 4)
            painter.drawEllipse(QPointF(x + 25, y), 4, 4)
            painter.drawLine(QPointF(x - 21, y), QPointF(x + 21, y if pressed else y - 20))
            if pressed:
                painter.setPen(QPen(QColor("#44d7b6"), 2))
                painter.drawEllipse(QPointF(x, y), 30, 30)
        elif "arm" in kind or kind == "dobot-magician":
            painter.setPen(QPen(QColor("#e7b66b"), 7, Qt.PenStyle.SolidLine, Qt.PenCapStyle.RoundCap))
            angle = float(self.state.get("values", {}).get("joint1Deg", 20) or 20) * math.pi / 180
            end = QPointF(x + math.cos(angle) * 27, y - 25 - math.sin(angle) * 18)
            painter.drawLine(QPointF(x - 28, y + 20), QPointF(x - 14, y - 20))
            painter.drawLine(QPointF(x - 14, y - 20), end)
            painter.setPen(QPen(QColor("#9aafc0"), 2))
            painter.drawLine(end, end + QPointF(12, 12))
            painter.drawLine(QPointF(x - 43, y + 24), QPointF(x - 10, y + 24))
        elif kind in {"voltmeter", "ammeter", "serial-monitor", "debugger"}:
            painter.setBrush(QColor("#111e29"))
            painter.drawRoundedRect(QRectF(x - 48, y - 25, 96, 46), 4, 4)
            painter.setPen(QColor("#63e5bf"))
            painter.setFont(QFont("Consolas", 14))
            text = "V" if kind == "voltmeter" else "A" if kind == "ammeter" else ">_" if kind == "serial-monitor" else "CPU"
            painter.drawText(QRectF(x - 45, y - 25, 90, 46), Qt.AlignmentFlag.AlignCenter, text)
        else:
            painter.setBrush(QColor("#263d4b"))
            painter.drawRoundedRect(QRectF(x - 26, y - 24, 52, 45), 6, 6)
            painter.setPen(QColor("#adc9d6"))
            painter.setFont(QFont("Consolas", 9))
            painter.drawText(QRectF(x - 40, y - 22, 80, 42), Qt.AlignmentFlag.AlignCenter, kind.upper().replace("-", "\n")[:18])

    def itemChange(self, change, value):
        if change == QGraphicsItem.GraphicsItemChange.ItemPositionHasChanged and self.scene() and not self.host_scene._sync:
            self.host_scene.update_wires()
        return super().itemChange(change, value)

    def mouseReleaseEvent(self, event):
        super().mouseReleaseEvent(event)
        self.host_scene.commit_positions()

    def mouseDoubleClickEvent(self, event):
        if self.render_kind in {"switch", "tactile-switch"}:
            self.host_scene.device_toggled.emit(self.component["id"], not self.component.get("properties", {}).get("pressed", False))
            event.accept()
        elif self.render_kind in {"serial-monitor", "debugger"}:
            self.host_scene.instrument_requested.emit(self.component["id"])
            event.accept()
        else:
            super().mouseDoubleClickEvent(event)


class WireItem(QGraphicsPathItem):
    """@brief A selectable wire links exactly two explicit terminals."""

    def __init__(self, wire: dict, scene: "CircuitScene"):
        super().__init__()
        self.wire = deepcopy(wire)
        self.host_scene = scene
        self.setFlag(QGraphicsItem.GraphicsItemFlag.ItemIsSelectable)
        self.setZValue(-1)
        self.setPen(QPen(QColor(wire.get("color", "#5bbfa8")), 2.2))
        self.setToolTip(f"{wire.get('label') or 'Wire'}\n{wire['from']['componentId']}.{wire['from']['pinId']} → {wire['to']['componentId']}.{wire['to']['pinId']}\nDouble-click to create an explicit junction.")

    def update_path(self):
        a, b = self.host_scene.pin_position(self.wire["from"]), self.host_scene.pin_position(self.wire["to"])
        if a is None or b is None:
            return
        middle = (a.x() + b.x()) / 2
        path = QPainterPath(a)
        path.cubicTo(QPointF(middle, a.y()), QPointF(middle, b.y()), b)
        self.setPath(path)

    def paint(self, painter, option, widget=None):
        pen = QPen(QColor("#e9f8b5") if self.isSelected() else QColor(self.wire.get("color", "#5bbfa8")), 3 if self.isSelected() else 2.2)
        self.setPen(pen)
        super().paint(painter, option, widget)

    def mouseDoubleClickEvent(self, event):
        point = event.scenePos()
        self.host_scene.split_wire(self.wire["id"], point.x(), point.y())
        event.accept()


class CircuitScene(QGraphicsScene):
    """@brief Reusable circuit scene with immutable domain edits emitted to its host."""

    project_edited = Signal(dict)
    selection_changed = Signal(list, list)
    request_place = Signal(str, float, float)
    command_requested = Signal(str)
    device_toggled = Signal(str, bool)
    instrument_requested = Signal(str)
    notice = Signal(str)

    def __init__(self, registry, parent=None):
        super().__init__(parent)
        self.registry = registry
        self.project = {"schemaVersion": "1.4.0", "name": "Untitled circuit", "components": [], "wires": []}
        self.parts: dict[str, ComponentItem] = {}
        self.wires: dict[str, WireItem] = {}
        self._sync = False
        self._pending_pin: dict | None = None
        self._draft = QGraphicsPathItem()
        self._draft.setPen(QPen(QColor(COLORS["accent"]), 2, Qt.PenStyle.DashLine))
        self._draft.setZValue(10)
        self.addItem(self._draft)
        self.setSceneRect(-5000, -5000, 10000, 10000)
        self.selectionChanged.connect(self._selection)

    def set_project(self, project: dict):
        """@brief Reconcile structural edits while retaining unaffected scene objects."""
        self._sync = True
        self.cancel_wire()
        self.project = deepcopy(project)
        identifiers = {c["id"] for c in project["components"]}
        for identifier in set(self.parts) - identifiers:
            self.removeItem(self.parts.pop(identifier))
        wire_ids = {w["id"] for w in project["wires"]}
        for identifier in set(self.wires) - wire_ids:
            self.removeItem(self.wires.pop(identifier))
        for component in project["components"]:
            existing = self.parts.get(component["id"])
            if existing and existing.component["kind"] != component["kind"]:
                self.removeItem(self.parts.pop(component["id"]))
                existing = None
            if not existing:
                existing = ComponentItem(component, self.registry.get(component["kind"]), self)
                self.parts[component["id"]] = existing
                self.addItem(existing)
            existing.component = deepcopy(component)
            existing.setPos(component["position"]["x"], component["position"]["y"])
            existing.setRotation(component.get("rotation", 0))
            existing.update()
        for wire in project["wires"]:
            if wire["id"] not in self.wires:
                item = WireItem(wire, self)
                self.wires[wire["id"]] = item
                self.addItem(item)
            self.wires[wire["id"]].wire = deepcopy(wire)
        self.update_wires()
        self.setSceneRect(self.itemsBoundingRect().adjusted(-800, -800, 800, 800).united(QRectF(-1000, -1000, 2000, 2000)))
        self._sync = False
        self._selection()

    def _selection(self):
        if not self._sync:
            self.selection_changed.emit(self.selected_components(), self.selected_wires())

    def selected_components(self) -> list[str]:
        return [item.component["id"] for item in self.selectedItems() if isinstance(item, ComponentItem)]

    def selected_wires(self) -> list[str]:
        return [item.wire["id"] for item in self.selectedItems() if isinstance(item, WireItem)]

    def select_components(self, identifiers):
        self.clearSelection()
        for identifier in identifiers:
            if identifier in self.parts:
                self.parts[identifier].setSelected(True)

    def pin_position(self, endpoint: dict):
        part = self.parts.get(endpoint["componentId"])
        pin = part.pins.get(endpoint["pinId"]) if part else None
        return pin.scenePos() if pin else None

    def update_wires(self):
        for item in self.wires.values():
            item.update_path()

    def commit_positions(self):
        """@brief Commit an entire drag gesture once, including every selected part."""
        if self._sync:
            return
        positions = {identifier: {"x": item.pos().x(), "y": item.pos().y()} for identifier, item in self.parts.items()}
        changed = any(c["position"] != positions[c["id"]] for c in self.project["components"])
        if changed:
            self._commit(editing.move_components(self.project, positions))

    def _commit(self, project):
        self.set_project(project)
        self.project_edited.emit(deepcopy(project))

    def connect_pins(self, a: dict, b: dict):
        """@brief Create a wire between known terminals; crossing geometry is irrelevant."""
        try:
            self._commit(editing.connect(self.project, a, b, self.registry))
            self.notice.emit(f"Connected {a['pinId']} → {b['pinId']}")
        except ValueError as error:
            self.notice.emit(str(error))

    def pin_clicked(self, endpoint, _position):
        if self._pending_pin is None:
            self._pending_pin = deepcopy(endpoint)
            self.notice.emit(f"Wiring from {endpoint['pinId']} — click another pin, or Escape to cancel")
        else:
            source = self._pending_pin
            self.cancel_wire()
            self.connect_pins(source, endpoint)

    def cancel_wire(self):
        self._pending_pin = None
        self._draft.setPath(QPainterPath())

    def mouseMoveEvent(self, event):
        if self._pending_pin:
            origin = self.pin_position(self._pending_pin)
            if origin:
                path = QPainterPath(origin)
                path.lineTo(event.scenePos())
                self._draft.setPath(path)
        super().mouseMoveEvent(event)

    def split_wire(self, identifier, x, y):
        try:
            self._commit(editing.split_wire(self.project, identifier, x, y, self.registry))
        except ValueError as error:
            self.notice.emit(str(error))

    def apply_projection(self, projection: dict):
        """@brief Update only real live values; no structural scene rebuild per frame."""
        for identifier, item in self.parts.items():
            state = projection.get("components", {}).get(identifier, {})
            changed = item.state != state
            if changed:
                item.state = state
            lit = projection.get("ledStates", {}).get(identifier)
            next_lit = bool(lit) if lit is not None else None
            if item.render_kind in {"uno", "nano", "mega2560"}:
                onboard = projection.get("pinStates", {}).get(identifier, {}).get("D13")
                next_lit = bool(onboard) if onboard is not None else None
            if item.lit != next_lit:
                item.lit = next_lit
                changed = True
            for pin_id, pin in item.pins.items():
                levels = projection.get("pinStates", {}).get(identifier, {})
                level = levels.get(pin_id) if isinstance(levels, dict) else None
                if isinstance(level, dict):
                    level = level.get("level", level.get("state"))
                pin.set_level(level)
            if changed:
                item.update()

    def clear_projection(self):
        for part in self.parts.values():
            part.state = {}
            part.lit = False
            for pin in part.pins.values():
                pin.set_level(None)
            part.update()

    def drawBackground(self, painter, rect):
        painter.fillRect(rect, QColor("#101820"))
        if painter.transform().m11() < .22:
            return
        painter.setPen(QPen(QColor("#253744"), 1))
        left, top = math.floor(rect.left() / 20) * 20, math.floor(rect.top() / 20) * 20
        for x in range(left, math.ceil(rect.right()), 20):
            for y in range(top, math.ceil(rect.bottom()), 20):
                painter.drawPoint(QPointF(x, y))

    def contextMenuEvent(self, event):
        target = self.itemAt(event.scenePos(), self.views()[0].transform())
        while target and not isinstance(target, (ComponentItem, WireItem)):
            target = target.parentItem()
        if target and not target.isSelected():
            self.clearSelection()
            target.setSelected(True)
        menu = QMenu()
        for title, command in [("Copy", "copy"), ("Paste", "paste"), ("Duplicate", "duplicate"), ("Rotate 90°", "rotate"), ("Delete selection", "delete"), ("Select all", "select_all"), ("Fit circuit", "fit")]:
            menu.addAction(title, lambda _checked=False, value=command: self.command_requested.emit(value))
        menu.addSeparator()
        if isinstance(target, ComponentItem) and target.render_kind in BOARDS:
            menu.addAction("Load reference firmware…", lambda: self.command_requested.emit("reference"))
            menu.addAction("Load firmware file…", lambda: self.command_requested.emit("firmware"))
        if isinstance(target, ComponentItem) and target.render_kind in {"serial-monitor", "debugger"}:
            menu.addAction("Open instrument", lambda: self.instrument_requested.emit(target.component["id"]))
        menu.exec(event.screenPos())


class CircuitView(QGraphicsView):
    """@brief Native zoom/pan/rubber-band editing and catalogue drop target."""

    def __init__(self, scene: CircuitScene, parent=None):
        super().__init__(scene, parent)
        self.setRenderHints(QPainter.RenderHint.Antialiasing | QPainter.RenderHint.TextAntialiasing)
        self.setViewportUpdateMode(QGraphicsView.ViewportUpdateMode.BoundingRectViewportUpdate)
        self.setDragMode(QGraphicsView.DragMode.RubberBandDrag)
        self.setRubberBandSelectionMode(Qt.ItemSelectionMode.IntersectsItemShape)
        self.setTransformationAnchor(QGraphicsView.ViewportAnchor.AnchorUnderMouse)
        self.setAcceptDrops(True)
        self.setFocusPolicy(Qt.FocusPolicy.StrongFocus)
        self._space = False
        self._pan: QPoint | None = None
        self.setFrameShape(QGraphicsView.Shape.NoFrame)
        self.centerOn(400, 240)

    def fit_circuit(self):
        rect = QRectF()
        for item in self.scene().parts.values():
            rect = rect.united(item.sceneBoundingRect())
        if not rect.isNull():
            self.fitInView(rect.adjusted(-70, -70, 70, 70), Qt.AspectRatioMode.KeepAspectRatio)
            if self.transform().m11() > 1.5:
                self.scale(1.5 / self.transform().m11(), 1.5 / self.transform().m11())

    def wheelEvent(self, event):
        factor = 1.17 if event.angleDelta().y() > 0 else 1 / 1.17
        scale = self.transform().m11() * factor
        if .08 <= scale <= 3.5:
            self.scale(factor, factor)
        event.accept()

    def mousePressEvent(self, event):
        if event.button() == Qt.MouseButton.MiddleButton or (self._space and event.button() == Qt.MouseButton.LeftButton):
            self._pan = event.position().toPoint()
            self.setCursor(Qt.CursorShape.ClosedHandCursor)
            event.accept()
            return
        super().mousePressEvent(event)

    def mouseMoveEvent(self, event):
        if self._pan is not None:
            current = event.position().toPoint()
            delta = current - self._pan
            self.horizontalScrollBar().setValue(self.horizontalScrollBar().value() - delta.x())
            self.verticalScrollBar().setValue(self.verticalScrollBar().value() - delta.y())
            self._pan = current
            event.accept()
            return
        super().mouseMoveEvent(event)

    def mouseReleaseEvent(self, event):
        if self._pan is not None:
            self._pan = None
            self.setCursor(Qt.CursorShape.OpenHandCursor if self._space else Qt.CursorShape.ArrowCursor)
            event.accept()
            return
        super().mouseReleaseEvent(event)

    def keyPressEvent(self, event):
        if event.key() == Qt.Key.Key_Space:
            self._space = True
            self.setCursor(Qt.CursorShape.OpenHandCursor)
            event.accept()
        elif event.key() == Qt.Key.Key_Escape:
            self.scene().cancel_wire()
            event.accept()
        elif event.key() in {Qt.Key.Key_Delete, Qt.Key.Key_Backspace}:
            self.scene().command_requested.emit("delete")
            event.accept()
        elif event.modifiers() & Qt.KeyboardModifier.ControlModifier:
            commands = {Qt.Key.Key_C: "copy", Qt.Key.Key_V: "paste", Qt.Key.Key_D: "duplicate", Qt.Key.Key_A: "select_all"}
            if event.key() in commands:
                self.scene().command_requested.emit(commands[event.key()])
                event.accept()
            else:
                super().keyPressEvent(event)
        else:
            super().keyPressEvent(event)

    def keyReleaseEvent(self, event):
        if event.key() == Qt.Key.Key_Space:
            self._space = False
            self.setCursor(Qt.CursorShape.ArrowCursor)
        super().keyReleaseEvent(event)

    def dragEnterEvent(self, event):
        if event.mimeData().hasFormat("application/x-simulab-component"):
            event.acceptProposedAction()
        else:
            event.ignore()

    def dragMoveEvent(self, event):
        event.acceptProposedAction()

    def dropEvent(self, event):
        if event.mimeData().hasFormat("application/x-simulab-component"):
            kind = bytes(event.mimeData().data("application/x-simulab-component")).decode("utf-8")
            position = self.mapToScene(event.position().toPoint())
            self.scene().request_place.emit(kind, position.x(), position.y())
            event.acceptProposedAction()

"""@brief Native multifile Arduino editor; source is plain portable document data."""

from __future__ import annotations

from copy import deepcopy
import re

from PySide6.QtCore import QRect, QSize, Qt, Signal
from PySide6.QtGui import QColor, QFont, QPainter, QSyntaxHighlighter, QTextCharFormat
from PySide6.QtWidgets import QHBoxLayout, QInputDialog, QLabel, QPlainTextEdit, QPushButton, QTabWidget, QVBoxLayout, QWidget


class CppHighlighter(QSyntaxHighlighter):
    """@brief Lightweight C/C++ highlighting; it does not parse or execute firmware."""

    def highlightBlock(self, text):
        patterns = [(r"\b(?:void|int|float|double|bool|char|long|const|unsigned|class|struct|return|if|else|for|while|switch|case|break|include|define|static|auto|uint\d+_t|true|false)\b", "#91baff"), (r"\b(?:setup|loop|pinMode|digitalWrite|digitalRead|analogRead|analogWrite|delay|millis|Serial|HIGH|LOW|OUTPUT|INPUT|INPUT_PULLUP|LED_BUILTIN)\b", "#5cddc0"), (r'"(?:[^"\\]|\\.)*"', "#e9c180"), (r"\b\d+(?:\.\d+)?\b", "#e7a2d6"), (r"//.*", "#789087")]
        for pattern, color in patterns:
            fmt = QTextCharFormat()
            fmt.setForeground(QColor(color))
            for match in re.finditer(pattern, text):
                self.setFormat(match.start(), match.end() - match.start(), fmt)
        start = 0 if self.previousBlockState() == 1 else text.find("/*")
        self.setCurrentBlockState(0)
        while start >= 0:
            end = text.find("*/", start + 2)
            count = len(text) - start if end < 0 else end + 2 - start
            fmt = QTextCharFormat()
            fmt.setForeground(QColor("#789087"))
            self.setFormat(start, count, fmt)
            if end < 0:
                self.setCurrentBlockState(1)
                break
            start = text.find("/*", end + 2)


class LineNumbers(QWidget):
    def __init__(self, editor):
        super().__init__(editor)
        self.editor = editor

    def sizeHint(self):
        return QSize(self.editor.gutter_width(), 0)

    def paintEvent(self, event):
        self.editor.paint_gutter(event)


class SourceEditor(QPlainTextEdit):
    """@brief Reusable native code input with line numbers and tab indentation."""

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setFont(QFont("Consolas", 11))
        self.setLineWrapMode(QPlainTextEdit.LineWrapMode.NoWrap)
        self.setTabStopDistance(self.fontMetrics().horizontalAdvance(" ") * 2)
        self.highlighter = CppHighlighter(self.document())
        self.gutter = LineNumbers(self)
        self.blockCountChanged.connect(self._margins)
        self.updateRequest.connect(self._gutter_update)
        self._margins()

    def gutter_width(self):
        return 18 + self.fontMetrics().horizontalAdvance("9") * len(str(max(1, self.blockCount())))

    def _margins(self, *_args):
        self.setViewportMargins(self.gutter_width(), 0, 0, 0)

    def _gutter_update(self, rect, dy):
        if dy:
            self.gutter.scroll(0, dy)
        else:
            self.gutter.update(0, rect.y(), self.gutter.width(), rect.height())
        if rect.contains(self.viewport().rect()):
            self._margins()

    def resizeEvent(self, event):
        super().resizeEvent(event)
        rect = self.contentsRect()
        self.gutter.setGeometry(QRect(rect.left(), rect.top(), self.gutter_width(), rect.height()))

    def paint_gutter(self, event):
        painter = QPainter(self.gutter)
        painter.fillRect(event.rect(), QColor("#16212c"))
        block = self.firstVisibleBlock()
        number = block.blockNumber()
        top = round(self.blockBoundingGeometry(block).translated(self.contentOffset()).top())
        bottom = top + round(self.blockBoundingRect(block).height())
        while block.isValid() and top <= event.rect().bottom():
            if block.isVisible() and bottom >= event.rect().top():
                painter.setPen(QColor("#728d9f"))
                painter.drawText(0, top, self.gutter.width() - 7, self.fontMetrics().height(), Qt.AlignmentFlag.AlignRight, str(number + 1))
            block = block.next()
            top = bottom
            bottom = top + round(self.blockBoundingRect(block).height())
            number += 1

    def keyPressEvent(self, event):
        if event.key() == Qt.Key.Key_Tab and not event.modifiers():
            self.insertPlainText("  ")
            return
        super().keyPressEvent(event)


class CodePanel(QWidget):
    """@brief Multifile source workspace with no hard binding to compiler or storage."""

    changed = Signal()

    def __init__(self, parent=None):
        super().__init__(parent)
        self.editors: dict[str, SourceEditor] = {}
        self._updating = False
        self.tabs = QTabWidget()
        self.tabs.setTabsClosable(True)
        self.tabs.tabCloseRequested.connect(self._remove_file)
        self.tabs.setDocumentMode(True)
        add = QPushButton("+ File")
        add.clicked.connect(self._add_file)
        self.position = QLabel("Arduino C/C++ · UTF-8")
        self.position.setObjectName("muted")
        header = QHBoxLayout()
        header.addWidget(self.position, 1)
        header.addWidget(add)
        layout = QVBoxLayout(self)
        layout.setContentsMargins(5, 5, 5, 5)
        layout.addLayout(header)
        layout.addWidget(self.tabs)

    def set_files(self, files: list[dict], active_file="sketch.ino"):
        """@brief Replace source tabs atomically without emitting user-edit signals."""
        self._updating = True
        while self.tabs.count():
            editor = self.tabs.widget(0)
            self.tabs.removeTab(0)
            editor.deleteLater()
        self.editors.clear()
        for source in files:
            editor = SourceEditor()
            editor.setPlainText(source["content"])
            editor.textChanged.connect(self._changed)
            self.editors[source["name"]] = editor
            self.tabs.addTab(editor, source["name"])
        if active_file in self.editors:
            self.tabs.setCurrentWidget(self.editors[active_file])
        self._updating = False

    def _changed(self):
        if not self._updating:
            self.changed.emit()

    def files(self) -> list[dict]:
        """@brief Return detached portable source text in tab order."""
        return [{"name": name, "content": editor.toPlainText()} for name, editor in self.editors.items()]

    def active_file(self) -> str:
        for name, editor in self.editors.items():
            if editor is self.tabs.currentWidget():
                return name
        return "sketch.ino"

    def _add_file(self):
        if len(self.editors) >= 32:
            self.position.setText("A workspace can contain at most 32 source files.")
            return
        name, accepted = QInputDialog.getText(self, "New source file", "Flat filename (.ino, .h, .hpp, .cpp, .c)")
        if not accepted:
            return
        if not re.fullmatch(r"[A-Za-z][A-Za-z0-9_-]{0,63}\.(ino|h|hpp|cpp|c)", name) or re.match(r"(?i)^(con|prn|aux|nul|com\d|lpt\d)\.", name) or name.casefold() in {s.casefold() for s in self.editors}:
            self.position.setText("Use a unique portable source filename.")
            return
        files = self.files() + [{"name": name, "content": ""}]
        self.set_files(files, name)
        self.changed.emit()

    def _remove_file(self, index):
        name = self.tabs.tabText(index)
        if name == "sketch.ino":
            self.position.setText("sketch.ino is the required entry point.")
            return
        if name in self.editors:
            files = [source for source in self.files() if source["name"] != name]
            self.set_files(files)
            self.changed.emit()

"""@brief Small injected background job adapter for blocking non-Qt services."""

import traceback
from PySide6.QtCore import QObject, QRunnable, Signal, Slot


class TaskSignals(QObject):
    """@brief Cross-thread result channels delivered on the receiver's Qt thread."""
    result = Signal(object)
    error = Signal(str)
    progress = Signal(dict)
    finished = Signal()


class BackgroundTask(QRunnable):
    """@brief Execute an injected callable; no UI object is touched in the worker."""

    def __init__(self, operation):
        super().__init__()
        self.operation = operation
        self.signals = TaskSignals()

    @Slot()
    def run(self):
        try:
            self.signals.result.emit(self.operation(self.signals.progress.emit))
        except Exception as error:
            self.signals.error.emit(str(error))
        finally:
            self.signals.finished.emit()

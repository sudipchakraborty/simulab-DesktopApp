"""@brief Asynchronous versioned transport to an isolated genuine MCU runtime."""

from __future__ import annotations

import base64
import json
import os
from pathlib import Path
import shutil

from PySide6.QtCore import QObject, QProcess, Signal


class RuntimeProcess(QObject):
    """@brief Supervise a replaceable local engine without blocking the Qt event loop.
    @param node Executable path; otherwise SIMULAB_NODE or the system PATH is used.
    @param bridge Standalone bridge entry; defaults to the installed package.
    """

    message = Signal(dict)
    failed = Signal(str)
    ready = Signal()

    def __init__(self, node: str | None = None, bridge: Path | None = None, parent=None):
        super().__init__(parent)
        self.node = node or os.environ.get("SIMULAB_NODE") or shutil.which("node")
        self.bridge = bridge or Path(__file__).parents[1] / "runtime" / "bridge.mjs"
        self.process = QProcess(self)
        self.process.setProcessChannelMode(QProcess.ProcessChannelMode.SeparateChannels)
        self.process.readyReadStandardOutput.connect(self._read)
        self.process.readyReadStandardError.connect(self._read_error)
        self.process.errorOccurred.connect(self._error)
        self.process.finished.connect(self._finished)
        self.session = 0
        self._id = 0
        self._ready = False
        self._closing = False
        self._buffer = bytearray()
        self._pending: list[dict] = []
        self.last_stderr = ""

    def start(self) -> bool:
        """@brief Start the injected Node executable; missing dependencies fail visibly."""
        if self.process.state() != QProcess.ProcessState.NotRunning:
            return True
        if not self.node:
            self.failed.emit("Node.js 24+ is required for real MCU execution. Install Node or set SIMULAB_NODE.")
            return False
        if not self.bridge.is_file():
            self.failed.emit(f"Packaged runtime is missing: {self.bridge}")
            return False
        self._ready = False
        self._closing = False
        self._buffer.clear()
        self.last_stderr = ""
        self.process.start(self.node, [str(self.bridge)])
        return True

    def send(self, command: str, **payload) -> int:
        """@brief Queue a session-owned command and return its transport request ID."""
        self._id += 1
        message = {"version": "1.0.0", "id": self._id, "session": self.session, "type": command, **payload}
        if not self.start():
            return self._id
        if self._ready:
            self._write(message)
        else:
            self._pending.append(message)
        return self._id

    def load_image(self, project: dict, target: str, image: bytes, *, image_format: str) -> int:
        """@brief Load actual image bytes under a fresh monotonic firmware identity."""
        self.session += 1
        self._pending.clear()
        if image_format == "hex":
            payload = {"hex": image.decode("ascii")}
        elif image_format == "bin":
            payload = {"firmwareBase64": base64.b64encode(image).decode("ascii")}
        else:
            raise ValueError("Only Intel HEX or merged ESP32-S3 BIN firmware is executable.")
        return self.send("load", project=project, target=target, **payload)

    def invalidate(self):
        """@brief Discard stale engine replies and stop the prior circuit's process."""
        self.session += 1
        self.close()

    def _write(self, message: dict):
        self.process.write((json.dumps(message, separators=(",", ":"), allow_nan=False) + "\n").encode("utf-8"))

    def _read(self):
        if self._closing:
            self.process.readAllStandardOutput()
            return
        self._buffer.extend(bytes(self.process.readAllStandardOutput()))
        if len(self._buffer) > 4_000_000:
            self.failed.emit("Runtime reply exceeded the bounded transport limit.")
            self.invalidate()
            return
        while b"\n" in self._buffer:
            line, _, remainder = self._buffer.partition(b"\n")
            self._buffer = bytearray(remainder)
            if not line:
                continue
            try:
                reply = json.loads(line)
                if not isinstance(reply, dict):
                    raise ValueError("Expected a runtime object.")
            except (ValueError, UnicodeError) as error:
                self.failed.emit(f"Invalid runtime reply: {error}")
                continue
            if reply.get("type") == "ready":
                self._ready = True
                for command in self._pending:
                    if command["session"] == self.session:
                        self._write(command)
                self._pending.clear()
                self.ready.emit()
                continue
            if reply.get("session") != self.session:
                continue
            if reply.get("type") == "error":
                self.failed.emit(str(reply.get("message", "Runtime execution failed.")))
            self.message.emit(reply)

    def _read_error(self):
        self.last_stderr = (self.last_stderr + bytes(self.process.readAllStandardError()).decode("utf-8", "replace"))[-16000:]

    def _error(self, _error):
        if not self._closing:
            self.failed.emit(f"Unable to execute the real MCU runtime: {self.process.errorString()}")

    def _finished(self, code, _status):
        self._ready = False
        if code and not self._closing:
            self.failed.emit(f"Runtime exited ({code}): {self.last_stderr[-2000:]}")

    def close(self):
        """@brief Release only this adapter's child process and pending commands."""
        self._closing = True
        self._pending.clear()
        if self.process.state() != QProcess.ProcessState.NotRunning:
            if self._ready:
                self._write({"version": "1.0.0", "id": 0, "session": self.session, "type": "dispose"})
                self.process.closeWriteChannel()
            if not self.process.waitForFinished(200):
                self.process.terminate()
                if not self.process.waitForFinished(200):
                    self.process.kill()
                    self.process.waitForFinished(200)
        self._ready = False

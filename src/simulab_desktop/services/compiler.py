"""@brief Qt-free, bounded transport for the real local compiler companion.

All methods block: GUI callers must use their own background worker. Tokens and
downloaded firmware are deliberately never persisted by this module.
"""
from __future__ import annotations

from collections.abc import Callable, Mapping, Sequence
import http.client
import json
import math
import queue
import re
import secrets
import socket
import threading
import time
from typing import Any
from urllib.parse import quote, urlsplit

BOARDS = frozenset(("uno", "nano", "mega2560", "esp32", "esp32s3", "yd-n16r8"))
LIBRARIES = frozenset(("RTClib", "Adafruit NeoPixel", "FastLED"))
_SOURCE = re.compile(r"[A-Za-z][A-Za-z0-9_-]{0,63}\.(?:ino|h|hpp|cpp|c)\Z")
_RESERVED = re.compile(r"(?:con|prn|aux|nul|com[0-9]|lpt[0-9])\.", re.I)
_JOB = re.compile(r"[a-f0-9]{32}\Z")
_ARTIFACT = re.compile(r"[A-Za-z0-9_-][A-Za-z0-9_.-]{0,200}\.(?:hex|bin|elf)\Z")


class CompilerError(RuntimeError):
    """@brief Actionable compiler transport or host failure, with optional HTTP status."""

    def __init__(self, message: str, status: int | None = None):
        super().__init__(message)
        self.status = status


class CompilerCancelled(CompilerError):
    """@brief The caller cancelled; any eventual server result has been discarded."""


class _PendingRequest:
    def __init__(self):
        self.lock = threading.Lock()
        self.connection: http.client.HTTPConnection | None = None
        self.cancelled = False

    def attach(self, connection):
        with self.lock:
            if self.cancelled:
                raise CompilerCancelled("Compilation cancelled; result discarded")
            self.connection = connection

    def abort(self):
        with self.lock:
            self.cancelled = True
            connection = self.connection
            if connection is not None:
                try:
                    if connection.sock is not None:
                        connection.sock.shutdown(socket.SHUT_RDWR)
                except OSError:
                    pass
                connection.close()


def _positive(value: float, name: str) -> float:
    if not isinstance(value, (int, float)) or not math.isfinite(value) or value <= 0:
        raise ValueError(f"{name} must be a positive finite duration")
    return float(value)


def _files(files: Mapping[str, str] | Sequence[dict]) -> list[dict[str, str]]:
    if isinstance(files, Mapping):
        files = [{"name": name, "content": content} for name, content in files.items()]
    if not isinstance(files, (list, tuple)) or not 1 <= len(files) <= 32:
        raise ValueError("Expected 1..32 flat source files")
    names, result, size = set(), [], 0
    for item in files:
        if not isinstance(item, dict):
            raise ValueError("Expected source objects with name and content")
        name, content = item.get("name"), item.get("content")
        if (not isinstance(name, str) or not _SOURCE.fullmatch(name) or _RESERVED.match(name)
                or name.lower() in names or not isinstance(content, str) or "\0" in content):
            raise ValueError("Invalid or duplicate source filename/content")
        try:
            size += len(content.encode("utf-8"))
        except UnicodeError as error:
            raise ValueError("Source must contain valid UTF-8 text") from error
        if size > 1_000_000:
            raise ValueError("Source project exceeds 1 MB")
        names.add(name.lower())
        result.append({"name": name, "content": content})
    if "sketch.ino" not in names:
        raise ValueError("Project requires sketch.ino")
    return result


class CompilerClient:
    """@brief Blocking stdlib transport to a numeric loopback compiler endpoint.
    @param base_url Exact http://127.0.0.1:PORT, without path or credentials.
    @param token Optional in-memory bearer credential; never written or displayed.
    @param request_timeout Bound for status, artifacts and progress HTTP calls.
    @param compile_timeout End-to-end build wait bound, including progress polling.
    @param poll_interval Interval between genuine /compile-progress observations.
    """

    def __init__(self, base_url: str = "http://127.0.0.1:4317", token: str | None = None,
                 *, request_timeout: float = 10, compile_timeout: float = 600,
                 poll_interval: float = 0.15):
        try:
            parsed = urlsplit(base_url)
            port = parsed.port
        except (TypeError, ValueError) as error:
            raise ValueError("Compiler URL must be http://127.0.0.1:PORT") from error
        if (parsed.scheme != "http" or parsed.hostname != "127.0.0.1" or not port
                or parsed.username is not None or parsed.password is not None
                or parsed.path not in ("", "/") or parsed.query or parsed.fragment
                or parsed.netloc != f"127.0.0.1:{port}"):
            raise ValueError("Compiler URL must be http://127.0.0.1:PORT")
        if token is not None and (not isinstance(token, str) or "\r" in token or "\n" in token):
            raise ValueError("Invalid compiler token")
        self.base_url = f"http://127.0.0.1:{port}"
        self._port, self._token = port, token
        self.request_timeout = _positive(request_timeout, "request_timeout")
        self.compile_timeout = _positive(compile_timeout, "compile_timeout")
        self.poll_interval = _positive(poll_interval, "poll_interval")

    def _request(self, method: str, path: str, payload=None, *, binary=False,
                 timeout=None, pending: _PendingRequest | None = None):
        connection = http.client.HTTPConnection("127.0.0.1", self._port,
                                                timeout=timeout or self.request_timeout)
        try:
            if pending is not None:
                pending.attach(connection)
            headers = {"Accept": "application/octet-stream" if binary else "application/json"}
            if self._token:
                headers["Authorization"] = "Bearer " + self._token
            body = None
            if payload is not None:
                body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
                headers["Content-Type"] = "application/json"
            connection.request(method, path, body, headers)
            response = connection.getresponse()
            limit = 32 * 1024 * 1024 if binary and response.status == 200 else 4 * 1024 * 1024
            length = response.getheader("Content-Length")
            if length is not None and (not length.isdigit() or int(length) > limit):
                raise CompilerError("Compiler response exceeds the bounded size limit", response.status)
            data = response.read(limit + 1)
            if len(data) > limit:
                raise CompilerError("Compiler response exceeds the bounded size limit", response.status)
            if binary and response.status == 200:
                return data
            try:
                value = json.loads(data)
            except (ValueError, UnicodeError) as error:
                raise CompilerError("Compiler returned invalid JSON", response.status) from error
            if not isinstance(value, dict):
                raise CompilerError("Compiler returned an invalid response object", response.status)
            if response.status != 200:
                # Never follow redirects: this transport never sends credentials outside loopback.
                message = value.get("error", f"Compiler HTTP error {response.status}")
                raise CompilerError(str(message), response.status)
            return value
        except (OSError, http.client.HTTPException) as error:
            raise CompilerError(f"Cannot reach local compiler at {self.base_url}: {error}") from error
        finally:
            connection.close()

    def status(self) -> dict[str, Any]:
        """@brief Return real CLI availability/board metadata; no hardware claim is inferred."""
        return self._request("GET", "/status")

    def compile(self, board: str, files, on_progress: Callable[[dict], None] | None = None,
                cancel_event: threading.Event | None = None) -> dict[str, Any]:
        """@brief Compile current files and return the unchanged companion response dict.
        @param board Fixed compiler profile such as uno or esp32s3.
        @param files Mapping filename to text, or [{name,content}] flat source objects.
        @param on_progress Receives real server {percent,stage,elapsedMs,...} telemetry.
        @param cancel_event Cancellation promptly discards results; external hosts may keep building.
        @return {job,success,log,diagnostics,artifacts:[filename],board,cached,durationMs}.
        @details fetch_artifact accepts {job: result['job'], name: filename}. No client
        firmware cache is used: the server validates source/board/toolchain identity.
        """
        if not isinstance(board, str) or board not in BOARDS:
            raise ValueError("Unknown board profile")
        sources = _files(files)
        if cancel_event is not None and cancel_event.is_set():
            raise CompilerCancelled("Compilation cancelled; result discarded")
        request_id, pending = secrets.token_hex(16), _PendingRequest()
        progress_pending, finished = _PendingRequest(), threading.Event()
        results = queue.Queue()
        deadline = time.monotonic() + self.compile_timeout

        def build():
            try:
                value = self._request("POST", "/compile", {"board": board, "files": sources, "requestId": request_id},
                                      timeout=self.compile_timeout, pending=pending)
                results.put(("result", value, None))
            except Exception as error:
                results.put(("result", None, error))

        def observe():
            while not finished.is_set():
                try:
                    observation = self._request("GET", "/compile-progress/" + request_id,
                                                timeout=self.request_timeout, pending=progress_pending)
                    results.put(("progress", observation, None))
                except CompilerError as error:
                    if error.status != 404 and not finished.is_set():
                        results.put(("progress", None, error))
                if finished.wait(self.poll_interval):
                    return

        threading.Thread(target=build, name="simulab-compiler-request", daemon=True).start()
        if on_progress is not None:
            threading.Thread(target=observe, name="simulab-compiler-progress", daemon=True).start()
        last_progress = None
        try:
            while True:
                if cancel_event is not None and cancel_event.is_set():
                    raise CompilerCancelled("Compilation cancelled; result discarded")
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise CompilerError(f"Compilation timed out after {self.compile_timeout:g} seconds; result discarded", 504)
                try:
                    kind, result, error = results.get(timeout=min(0.025, remaining))
                    if cancel_event is not None and cancel_event.is_set():
                        raise CompilerCancelled("Compilation cancelled; result discarded")
                    if error is not None:
                        raise error
                    if kind == "progress":
                        if result != last_progress:
                            on_progress(result)
                            last_progress = result
                        continue
                    return result
                except queue.Empty:
                    pass
        finally:
            finished.set()
            pending.abort()
            progress_pending.abort()

    def fetch_artifact(self, artifact: Mapping[str, str]) -> bytes:
        """@brief Download a bounded real artifact using {job: 32-hex-id, name: filename}."""
        if not isinstance(artifact, Mapping):
            raise ValueError("Artifact descriptor requires job and name")
        job, name = artifact.get("job"), artifact.get("name")
        if (not isinstance(job, str) or not _JOB.fullmatch(job) or not isinstance(name, str)
                or not _ARTIFACT.fullmatch(name) or ".." in name):
            raise ValueError("Invalid artifact descriptor")
        return self._request("GET", f"/artifact/{job}/{quote(name, safe='')}", binary=True)

    def ports(self) -> dict:
        """@brief List real currently detected ports without initiating any upload."""
        return self._request("GET", "/ports")

    def libraries(self) -> dict:
        """@brief List installed libraries and the companion's approved component list."""
        return self._request("GET", "/libraries")

    def install_library(self, name: str) -> dict:
        """@brief Explicitly install one approved library; caller initiates network access."""
        if not isinstance(name, str) or name not in LIBRARIES:
            raise ValueError("Library is not in the approved component library list")
        return self._request("POST", "/libraries/install", {"name": name}, timeout=self.compile_timeout)


from .compiler_host import LocalCompiler  # noqa: E402 -- host imports client lazily.

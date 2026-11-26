"""@brief Own the standalone compiler host and all of its private descendants."""
from __future__ import annotations

import json
import os
from pathlib import Path
import queue
import secrets
import shutil
import signal
import subprocess
import tempfile
import threading
import time


def _resolve_executable(value):
    if not value:
        return None
    found = shutil.which(str(value))
    path = Path(found or value).expanduser().resolve()
    return str(path) if path.is_file() else None


def _is_link_or_reparse(path: Path) -> bool:
    """Detect POSIX links and Windows junction/reparse paths on Python 3.11+."""
    try:
        return path.is_symlink() or bool(getattr(path.lstat(), "st_file_attributes", 0) & 0x400)
    except FileNotFoundError:
        return False


def discover_toolchain(cli_executable=None, config_file=None):
    """@brief Find an installed CLI/configuration without importing sibling source.
    @param cli_executable Explicit executable wins over environment/PATH/local installs.
    @param config_file Optional existing Arduino config, containing installed core paths.
    @return (executable_or_None, config_or_None); never downloads or installs tools.
    """
    roots = [Path.cwd() / ".local", Path.cwd() / "simulab-backend" / ".local",
             Path.cwd().parent / "simulab-backend" / ".local"]
    for ancestor in Path(__file__).resolve().parents:
        roots.append(ancestor / "simulab-backend" / ".local")
    requested = cli_executable if cli_executable is not None else os.environ.get("ARDUINO_CLI")
    executable = _resolve_executable(requested) if requested is not None else _resolve_executable("arduino-cli")
    if requested is None and executable is None:
        executable = next((str((root / name).resolve()) for root in roots
                           for name in ("arduino-cli.exe", "arduino-cli") if (root / name).is_file()), None)
    requested_config = config_file if config_file is not None else os.environ.get("ARDUINO_CONFIG")
    if requested_config is not None:
        path = Path(requested_config).expanduser().resolve()
        if not path.is_file():
            from .compiler import CompilerError
            raise CompilerError(f"Arduino configuration does not exist: {path}")
        config = str(path)
    elif executable and (Path(executable).parent / "arduino-cli.yaml").is_file():
        config = str(Path(executable).parent / "arduino-cli.yaml")
    else:
        config = None
    return executable, config


class LocalCompiler:
    """@brief Injectably supervise a private ephemeral-loopback compiler host.
    @param node_executable Existing Node executable (Node 24+ is supported).
    @param cli_executable Installed Arduino CLI; missing tools yield actionable status.
    @param config_file Existing installed-toolchain YAML configuration.
    @param cache_dir Parent of private per-start build/cache directories.
    @param runtime_dir Optional independent copy of the bundled compiler host modules.
    @details start() is required before operations, or use the context manager. All
    methods block and belong in a background worker. close() kills this process tree
    only; a Windows Job Object binds descendants to the owning Python lifecycle.
    """

    def __init__(self, *, node_executable=None, cli_executable=None, config_file=None,
                 cache_dir=None, runtime_dir=None, request_timeout=10, compile_timeout=600,
                 poll_interval=0.15, startup_timeout=10):
        from .compiler import _positive
        self.node_executable = _resolve_executable(node_executable or "node")
        self.cli_executable, self.config_file = discover_toolchain(cli_executable, config_file)
        default_cache = Path(os.environ.get("LOCALAPPDATA", Path.home() / ".cache")) / "SimuLabDesktop" / "compiler"
        self.cache_dir = Path(cache_dir or default_cache).expanduser().resolve()
        self.runtime_dir = Path(runtime_dir or Path(__file__).resolve().parent.parent / "compiler_runtime").resolve()
        self.startup_timeout = _positive(startup_timeout, "startup_timeout")
        self._options = dict(request_timeout=request_timeout, compile_timeout=compile_timeout, poll_interval=poll_interval)
        self._process = None
        self._job = None
        self._client = None
        self._token = None
        self._runtime_root = None
        self._root_identity = None

    @property
    def client(self):
        """@brief Get the started host's transport, otherwise raise an actionable error."""
        from .compiler import CompilerError
        if self._client is None or self._process is None or self._process.poll() is not None:
            raise CompilerError("Local compiler is not running; call start()")
        return self._client

    @property
    def process_id(self):
        """@brief Return the live owned host PID for diagnostics, or None."""
        return self._process.pid if self._process is not None and self._process.poll() is None else None

    @property
    def runtime_root(self) -> Path | None:
        """@brief Read the unique owned build root, or None after successful cleanup.
        @return Per-start directory beneath cache_dir; never contains the token.
        """
        return self._runtime_root

    def start(self):
        """@brief Launch the bundled host with an in-memory token; return this service."""
        from .compiler import CompilerClient, CompilerError
        if self.process_id is not None:
            return self
        self.close()
        if self.node_executable is None:
            raise CompilerError("Node.js is required for local compilation. Install Node 24+ or pass node_executable.")
        host = self.runtime_dir / "host.mjs"
        if not host.is_file():
            raise CompilerError(f"Bundled compiler host is missing: {host}")
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        if self.cache_dir.resolve() != self.cache_dir:
            raise CompilerError("Compiler cache parent changed to a symbolic link; select a stable local directory")
        self._runtime_root = Path(tempfile.mkdtemp(prefix="host-", dir=self.cache_dir))
        identity = self._runtime_root.stat(follow_symlinks=False)
        self._root_identity = (identity.st_dev, identity.st_ino)
        self._token = secrets.token_hex(32)
        environment = os.environ.copy()
        environment.pop("SIMULAB_TOKEN", None)
        options = dict(stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                       text=True, encoding="utf-8", errors="replace", bufsize=1, env=environment,
                       cwd=str(self.runtime_dir))
        if os.name == "nt":
            options["creationflags"] = subprocess.CREATE_NO_WINDOW | subprocess.CREATE_NEW_PROCESS_GROUP
        else:
            options["start_new_session"] = True
        try:
            self._process = subprocess.Popen([self.node_executable, str(host)], **options)
            if os.name == "nt":
                self._job = _windows_job(self._process)
            ready = queue.Queue(maxsize=1)
            owned = self._process

            def read_ready():
                try:
                    line = owned.stdout.readline(4097)
                    value = json.loads(line) if 0 < len(line) <= 4096 else {}
                    ready.put(value)
                except Exception:
                    ready.put({})

            threading.Thread(target=read_ready, name="simulab-compiler-start", daemon=True).start()
            configuration = {"token": self._token, "executable": self.cli_executable,
                             "configFile": self.config_file, "root": str(self._runtime_root),
                             "timeoutMs": max(1000, min(1_800_000, int(self._options["compile_timeout"] * 1000)))}
            owned.stdin.write(json.dumps(configuration) + "\n")
            owned.stdin.flush()
            try:
                hello = ready.get(timeout=self.startup_timeout)
            except queue.Empty as error:
                raise CompilerError("Local compiler host startup timed out") from error
            if hello.get("type") != "ready" or not isinstance(hello.get("port"), int):
                raise CompilerError("Local compiler host could not start; verify Node 24+ and compiler resources")
            self._client = CompilerClient(f"http://127.0.0.1:{hello['port']}", self._token, **self._options)
            return self
        except Exception:
            self.close()
            raise

    def status(self):
        """@brief Report installed CLI availability with missing-tool instructions."""
        result = self.client.status()
        if not result.get("available"):
            result["message"] = result.get("version") or "Arduino CLI is unavailable; set ARDUINO_CLI and ARDUINO_CONFIG."
        return result

    def compile(self, board, files, on_progress=None, cancel_event=None):
        """@brief Compile current sources through the owned host; see CompilerClient.compile."""
        return self.client.compile(board, files, on_progress, cancel_event)

    def fetch_artifact(self, artifact):
        """@brief Download {job,name} from the owned host without writing firmware to disk."""
        return self.client.fetch_artifact(artifact)

    def ports(self):
        """@brief Return detected ports; never initiate a physical upload."""
        return self.client.ports()

    def libraries(self):
        """@brief Return installed/approved component libraries."""
        return self.client.libraries()

    def install_library(self, name):
        """@brief Explicitly install an approved library through the owned host."""
        return self.client.install_library(name)

    def close(self):
        """@brief Close the host and its owned compiler daemon/process descendants."""
        process, self._process = self._process, None
        self._client, self._token = None, None
        if process is not None:
            try:
                if process.poll() is None:
                    try:
                        process.stdin.write('{"type":"shutdown"}\n')
                        process.stdin.flush()
                        process.wait(timeout=2)
                    except (OSError, ValueError, subprocess.TimeoutExpired):
                        if os.name == "nt":
                            # Job closure below is authoritative for the whole owned tree.
                            if self._job is None and process.poll() is None:
                                subprocess.run(["taskkill.exe", "/PID", str(process.pid), "/T", "/F"],
                                               creationflags=subprocess.CREATE_NO_WINDOW,
                                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=10)
                        else:
                            try:
                                os.killpg(process.pid, signal.SIGKILL)
                            except ProcessLookupError:
                                pass
            finally:
                if os.name != "nt":
                    # A graceful host exit can leave a non-daemon CLI command in
                    # the same private session. Clean its group independently.
                    try:
                        os.killpg(process.pid, signal.SIGKILL)
                    except ProcessLookupError:
                        pass
                if self._job is not None:
                    try:
                        _terminate_windows_job(self._job)
                    finally:
                        self._job = None
                if process.poll() is None:
                    try:
                        process.wait(timeout=5)
                    except subprocess.TimeoutExpired:
                        process.kill()
                        process.wait(timeout=5)
                for stream in (process.stdin, process.stdout):
                    if stream is not None:
                        try:
                            stream.close()
                        except OSError:
                            # A host startup failure can invalidate its pipe while
                            # TextIOWrapper still holds buffered shutdown text.
                            pass
        self._cleanup_runtime_root()

    def _cleanup_runtime_root(self):
        """Delete only this invocation's identity-checked, contained private root."""
        from .compiler import CompilerError
        root = self._runtime_root
        if root is None:
            return
        if (root.parent != self.cache_dir or not root.name.startswith("host-")
                or self.cache_dir.resolve() != self.cache_dir or root.resolve() != root
                or _is_link_or_reparse(root)):
            raise CompilerError("Refusing to remove compiler root: path ownership or symbolic-link containment changed")
        if not root.exists():
            self._runtime_root, self._root_identity = None, None
            return
        identity = root.stat(follow_symlinks=False)
        if (identity.st_dev, identity.st_ino) != self._root_identity:
            raise CompilerError("Refusing to remove compiler root: directory identity changed")
        # Do not recurse through any reparse/symbolic link. This check also makes
        # cleanup fail closed on files introduced outside the compiler process.
        for directory, dirs, files in os.walk(root, followlinks=False):
            for name in (*dirs, *files):
                child = Path(directory) / name
                if _is_link_or_reparse(child) or not child.resolve().is_relative_to(root):
                    raise CompilerError("Refusing to remove compiler root containing a symbolic-link escape")
        shutil.rmtree(root)
        self._runtime_root, self._root_identity = None, None

    def __enter__(self):
        return self.start()

    def __exit__(self, *_args):
        self.close()


def _windows_job(process):
    """Bind all descendants before host receives configuration or can start tools."""
    import ctypes
    from ctypes import wintypes

    class BasicLimits(ctypes.Structure):
        _fields_ = [("PerProcessUserTimeLimit", ctypes.c_int64), ("PerJobUserTimeLimit", ctypes.c_int64),
                    ("LimitFlags", wintypes.DWORD), ("MinimumWorkingSetSize", ctypes.c_size_t),
                    ("MaximumWorkingSetSize", ctypes.c_size_t), ("ActiveProcessLimit", wintypes.DWORD),
                    ("Affinity", ctypes.c_size_t), ("PriorityClass", wintypes.DWORD),
                    ("SchedulingClass", wintypes.DWORD)]

    class IoCounters(ctypes.Structure):
        _fields_ = [(name, ctypes.c_uint64) for name in ("ReadOperationCount", "WriteOperationCount", "OtherOperationCount",
                                                       "ReadTransferCount", "WriteTransferCount", "OtherTransferCount")]

    class ExtendedLimits(ctypes.Structure):
        _fields_ = [("BasicLimitInformation", BasicLimits), ("IoInfo", IoCounters),
                    ("ProcessMemoryLimit", ctypes.c_size_t), ("JobMemoryLimit", ctypes.c_size_t),
                    ("PeakProcessMemoryUsed", ctypes.c_size_t), ("PeakJobMemoryUsed", ctypes.c_size_t)]

    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel.CreateJobObjectW.argtypes = (ctypes.c_void_p, wintypes.LPCWSTR)
    kernel.CreateJobObjectW.restype = wintypes.HANDLE
    kernel.SetInformationJobObject.argtypes = (wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD)
    kernel.AssignProcessToJobObject.argtypes = (wintypes.HANDLE, wintypes.HANDLE)
    kernel.CloseHandle.argtypes = (wintypes.HANDLE,)
    job = kernel.CreateJobObjectW(None, None)
    if not job:
        raise OSError(ctypes.get_last_error(), "Cannot create owned compiler process job")
    limits = ExtendedLimits()
    limits.BasicLimitInformation.LimitFlags = 0x2000  # JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
    if (not kernel.SetInformationJobObject(job, 9, ctypes.byref(limits), ctypes.sizeof(limits))
            or not kernel.AssignProcessToJobObject(job, wintypes.HANDLE(int(process._handle)))):
        error = ctypes.get_last_error()
        kernel.CloseHandle(job)
        raise OSError(error, "Cannot bind owned compiler process job")
    return job


def _terminate_windows_job(job):
    """Terminate and observe every owned descendant before directory cleanup."""
    import ctypes
    from ctypes import wintypes

    class Accounting(ctypes.Structure):
        _fields_ = [(name, ctypes.c_int64) for name in ("TotalUserTime", "TotalKernelTime",
                                                       "ThisPeriodTotalUserTime", "ThisPeriodTotalKernelTime")]
        _fields_ += [(name, wintypes.DWORD) for name in ("TotalPageFaultCount", "TotalProcesses",
                                                       "ActiveProcesses", "TotalTerminatedProcesses")]

    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel.TerminateJobObject.argtypes = (wintypes.HANDLE, wintypes.UINT)
    kernel.QueryInformationJobObject.argtypes = (wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p,
                                                wintypes.DWORD, ctypes.c_void_p)
    kernel.CloseHandle.argtypes = (wintypes.HANDLE,)
    try:
        if not kernel.TerminateJobObject(job, 0):
            raise OSError(ctypes.get_last_error(), "Cannot stop owned compiler process job")
        deadline = time.monotonic() + 5
        while True:
            accounting = Accounting()
            if not kernel.QueryInformationJobObject(job, 1, ctypes.byref(accounting), ctypes.sizeof(accounting), None):
                raise OSError(ctypes.get_last_error(), "Cannot verify stopped compiler descendants")
            if accounting.ActiveProcesses == 0:
                return
            if time.monotonic() >= deadline:
                raise OSError("Owned compiler descendants did not stop; private files retained")
            time.sleep(0.01)
    finally:
        kernel.CloseHandle(job)

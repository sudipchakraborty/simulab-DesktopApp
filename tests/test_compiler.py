"""Compiler boundary tests use a real bounded loopback HTTP fixture."""
from __future__ import annotations

import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import shutil
import threading
import time

import pytest

from simulab_desktop.services.compiler import (
    CompilerCancelled, CompilerClient, CompilerError, LocalCompiler,
)


@pytest.fixture
def companion():
    state = {"requests": [], "active": threading.Event(), "release": threading.Event(), "wait": False}

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass

        def reply(self, value, status=200, binary=False):
            body = value if binary else json.dumps(value).encode()
            self.send_response(status)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            try:
                self.wfile.write(body)
            except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
                pass

        def do_GET(self):
            state["requests"].append(("GET", self.path, self.headers.get("Authorization")))
            if self.path == "/status":
                self.reply({"available": True, "version": "1.5.1", "hardwareVerified": False})
            elif self.path.startswith("/compile-progress/"):
                if state.get("stall_progress"):
                    state["progress_active"].set()
                    state["release"].wait(2)
                self.reply({"percent": 37, "stage": "Compiling", "elapsedMs": 14})
            elif self.path == "/artifact/" + "b" * 32 + "/sketch.ino.hex":
                self.reply(b":00000001FF\n", binary=True)
            elif self.path == "/ports":
                self.reply({"ports": []})
            elif self.path == "/libraries":
                self.reply({"output": "[]", "error": "", "allowedLibraries": ["RTClib"]})
            else:
                self.reply({"error": "Unavailable"}, 404)

        def do_POST(self):
            data = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            state["requests"].append(("POST", self.path, data))
            if self.path == "/compile":
                state["active"].set()
                if state["wait"]:
                    state["release"].wait(2)
                else:
                    time.sleep(0.07)
                self.reply({"job": "b" * 32, "success": True, "log": "actual fixture build",
                            "diagnostics": [], "artifacts": ["sketch.ino.hex"],
                            "board": data["board"], "cached": False, "durationMs": 70})
            elif self.path == "/libraries/install":
                self.reply({"success": True, "log": data["name"]})
            else:
                self.reply({"error": "Unknown operation"}, 404)

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_port}", state
    finally:
        state["release"].set()
        server.shutdown()
        server.server_close()
        thread.join(2)


def test_compile_returns_companion_response_and_real_progress(companion):
    url, state = companion
    client = CompilerClient(url, "private-fixture-token", poll_interval=0.01)
    updates = []
    result = client.compile("uno", [{"name": "sketch.ino", "content": "void setup(){} void loop(){}"}], updates.append)
    assert result["board"] == "uno"
    assert result["artifacts"] == ["sketch.ino.hex"]
    assert any(p["percent"] == 37 for p in updates)
    posted = next(r[2] for r in state["requests"] if r[:2] == ("POST", "/compile"))
    assert len(posted["requestId"]) == 32
    assert client.fetch_artifact({"job": result["job"], "name": result["artifacts"][0]}) == b":00000001FF\n"
    assert client.status()["available"] is True
    assert ("GET", "/status", "Bearer private-fixture-token") in state["requests"]


@pytest.mark.parametrize("url", ["http://localhost:4317", "https://127.0.0.1:4317", "http://127.0.0.2:4317",
                                  "http://user:password@127.0.0.1:4317", "http://127.0.0.1:4317/path",
                                  "http://127.0.0.1:4317/?token=secret", "http://example.com:4317"])
def test_non_numeric_loopback_destinations_are_rejected(url):
    with pytest.raises(ValueError):
        CompilerClient(url)


@pytest.mark.parametrize("files", [[], [{"name": "../sketch.ino", "content": "x"}],
                                   [{"name": "con.ino", "content": "x"}],
                                   [{"name": "sketch.ino", "content": "a"}, {"name": "Sketch.ino", "content": "b"}],
                                   [{"name": "sketch.ino", "content": "x" * 1_000_001}],
                                   [{"name": "other.ino", "content": "x"}]])
def test_unsafe_or_oversized_sources_are_rejected_before_http(companion, files):
    url, state = companion
    with pytest.raises(ValueError):
        CompilerClient(url).compile("uno", files)
    assert state["requests"] == []


def test_unknown_board_and_artifact_traversal_are_rejected(companion):
    client = CompilerClient(companion[0])
    with pytest.raises(ValueError):
        client.compile("arbitrary:target", {"sketch.ino": "void setup(){}"})
    with pytest.raises(ValueError):
        client.fetch_artifact({"job": "b" * 32, "name": "../secret.hex"})


def test_cancel_discards_inflight_result_promptly(companion):
    url, state = companion
    state["wait"] = True
    cancel = threading.Event()
    timer = threading.Thread(target=lambda: (state["active"].wait(1), cancel.set()), daemon=True)
    timer.start()
    started = time.monotonic()
    with pytest.raises(CompilerCancelled):
        CompilerClient(url, poll_interval=0.01).compile("uno", {"sketch.ino": "void setup(){}"}, cancel_event=cancel)
    assert time.monotonic() - started < 0.5


def test_compile_timeout_discards_result(companion):
    url, state = companion
    state["wait"] = True
    with pytest.raises(CompilerError, match="timed out"):
        CompilerClient(url, compile_timeout=0.08, poll_interval=0.01).compile("uno", {"sketch.ino": "void setup(){}"})


def test_cancellation_remains_prompt_when_progress_connection_stalls(companion):
    url, state = companion
    state.update(wait=True, stall_progress=True, progress_active=threading.Event())
    cancel = threading.Event()
    threading.Thread(target=lambda: (state["progress_active"].wait(1), cancel.set()), daemon=True).start()
    started = time.monotonic()
    with pytest.raises(CompilerCancelled):
        CompilerClient(url, poll_interval=0.01).compile("uno", {"sketch.ino": "void setup(){}"},
                                                       lambda _progress: None, cancel)
    assert time.monotonic() - started < 0.5


def test_non_success_http_error_is_actionable(companion):
    with pytest.raises(CompilerError) as error:
        CompilerClient(companion[0]).fetch_artifact({"job": "c" * 32, "name": "sketch.ino.hex"})
    assert error.value.status == 404
    assert "Unavailable" in str(error.value)


def test_library_and_port_operations_use_restricted_routes(companion):
    client = CompilerClient(companion[0])
    assert client.ports() == {"ports": []}
    assert client.libraries()["allowedLibraries"] == ["RTClib"]
    assert client.install_library("RTClib")["success"] is True
    with pytest.raises(ValueError):
        client.install_library("unknown-library")


@pytest.mark.skipif(shutil.which("node") is None, reason="Node is an explicit runtime dependency")
def test_owned_host_without_toolchain_is_actionable_and_stops(tmp_path):
    with LocalCompiler(cli_executable=tmp_path / "missing-cli", cache_dir=tmp_path / "cache") as local:
        status = local.status()
        assert status["available"] is False
        assert "Arduino CLI" in (status.get("message", "") + status.get("version", ""))
        pid = local.process_id
        assert pid > 0
        url = local.client.base_url
    assert local.process_id is None
    with pytest.raises(CompilerError):
        CompilerClient(url, request_timeout=0.2).status()


def _alive(pid):
    if os.name == "nt":
        import ctypes
        kernel = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel.OpenProcess.restype = ctypes.c_void_p
        handle = kernel.OpenProcess(0x1000, False, pid)
        if not handle:
            return False
        code = ctypes.c_ulong()
        kernel.GetExitCodeProcess(ctypes.c_void_p(handle), ctypes.byref(code))
        kernel.CloseHandle(ctypes.c_void_p(handle))
        return code.value == 259
    try:
        os.kill(pid, 0)
        # A terminated orphan may await init reaping; it cannot execute work.
        stat = Path(f"/proc/{pid}/stat")
        return not stat.exists() or stat.read_text().split()[2] != "Z"
    except ProcessLookupError:
        return False


@pytest.mark.skipif(shutil.which("node") is None, reason="Node is an explicit runtime dependency")
def test_close_stops_descendant_even_after_host_exits_gracefully(tmp_path):
    runtime = tmp_path / "runtime"
    runtime.mkdir()
    (runtime / "host.mjs").write_text('''
import { createInterface } from 'node:readline';
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
let configured = false;
createInterface({input:process.stdin}).on('line', line => {
  const value = JSON.parse(line);
  if (configured) process.exit(0);
  configured = true;
  const child = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], {stdio:'ignore'});
  writeFileSync(join(value.root,'child-pid'), String(child.pid));
  process.stdout.write(JSON.stringify({type:'ready', port:12345})+'\\n');
});
''', encoding="utf-8")
    local = LocalCompiler(runtime_dir=runtime, cli_executable=tmp_path / "missing", cache_dir=tmp_path / "cache")
    try:
        local.start()
        child_pid = int(next((tmp_path / "cache").rglob("child-pid")).read_text())
        assert _alive(child_pid)
    finally:
        local.close()
    deadline = time.monotonic() + 2
    while _alive(child_pid) and time.monotonic() < deadline:
        time.sleep(0.01)
    assert not _alive(child_pid)


@pytest.fixture
def isolated_companion_runtime(tmp_path):
    """Use real companion workspace/cache behavior with only the compiler replaced."""
    import simulab_desktop.services.compiler_host as host_module
    runtime = tmp_path / "fixture-runtime"
    runtime.mkdir()
    service = Path(host_module.__file__).parent.parent / "compiler_runtime" / "service.mjs"
    script = '''
import { createInterface } from 'node:readline';
import { mkdir, writeFile, readFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { createCompanion } from __SERVICE_URL__;
let configured = false, server;
createInterface({input:process.stdin}).on('line', async line => {
  const value = JSON.parse(line);
  if (configured) { server.closeAllConnections(); server.close(); process.exit(0); }
  configured = true;
  const runner = async args => {
    if (args[0] !== 'compile') return {code:0, stdout:'fixture-cli', stderr:''};
    await writeFile(join(value.root,'compile-active-'+process.pid),'ready');
    while (true) {
      try { await access(__GATE__); break; }
      catch { await new Promise(resolve=>setTimeout(resolve,5)); }
    }
    const source = await readFile(join(args.at(-1),'sketch.ino'),'utf8');
    const output = args[args.indexOf('--output-dir')+1];
    await mkdir(output,{recursive:true});
    await writeFile(join(output,'sketch.ino.hex'),source);
    return {code:0, stdout:'fixture compilation', stderr:''};
  };
  server = createCompanion({token:value.token,origins:[],root:value.root,runner,
                           buildFingerprint:async()=>'deterministic-test-toolchain'});
  server.listen(0,'127.0.0.1',()=>process.stdout.write(JSON.stringify({type:'ready',port:server.address().port})+'\\n'));
});
'''
    (runtime / "host.mjs").write_text(script.replace("__SERVICE_URL__", json.dumps(service.as_uri()))
                                   .replace("__GATE__", json.dumps(str(tmp_path / "release"))), encoding="utf-8")
    return runtime


@pytest.mark.skipif(shutil.which("node") is None, reason="Node is an explicit runtime dependency")
def test_hosts_with_shared_cache_never_compile_each_others_source(tmp_path, isolated_companion_runtime):
    cache = tmp_path / "cache"
    first = LocalCompiler(cache_dir=cache, runtime_dir=isolated_companion_runtime)
    second = LocalCompiler(cache_dir=cache, runtime_dir=isolated_companion_runtime)
    results, errors = {}, []

    def compile_named(local, name):
        try:
            result = local.compile("uno", {"sketch.ino": name})
            assert result["success"], result
            results[name] = local.fetch_artifact({"job": result["job"], "name": "sketch.ino.hex"})
        except Exception as error:
            errors.append(error)

    workers = []
    try:
        first.start()
        second.start()
        for local, name in ((first, "first-source"), (second, "second-source")):
            thread = threading.Thread(target=compile_named, args=(local, name), daemon=True)
            workers.append(thread)
            thread.start()
        deadline = time.monotonic() + 5
        while len(list(cache.rglob("compile-active-*"))) < 2 and time.monotonic() < deadline:
            time.sleep(0.01)
        assert len(list(cache.rglob("compile-active-*"))) == 2
        (tmp_path / "release").touch()
        for thread in workers:
            thread.join(5)
            assert not thread.is_alive()
        assert errors == []
        assert results == {"first-source": b"first-source", "second-source": b"second-source"}
    finally:
        (tmp_path / "release").touch()
        first.close()
        second.close()


@pytest.mark.skipif(shutil.which("node") is None, reason="Node is an explicit runtime dependency")
def test_each_host_owns_unique_root_and_close_preserves_unrelated_data(tmp_path):
    cache = tmp_path / "cache"
    cache.mkdir()
    sentinel = cache / "unrelated-sentinel"
    sentinel.write_text("keep this", encoding="utf-8")
    first = LocalCompiler(cache_dir=cache, cli_executable=tmp_path / "missing")
    second = LocalCompiler(cache_dir=cache, cli_executable=tmp_path / "missing")
    try:
        first.start()
        second.start()
        root_a, root_b = first.runtime_root, second.runtime_root
        assert root_a != root_b
        assert root_a.parent == root_b.parent == cache.resolve()
        assert root_a.is_dir() and root_b.is_dir()
        (root_a / "temporary-build.log").write_text("delete owned output")
        first.close()
        assert not root_a.exists()
        assert root_b.is_dir()
        assert sentinel.read_text() == "keep this"
        first.start()
        assert first.runtime_root not in (root_a, root_b)
    finally:
        first.close()
        second.close()
    assert list(cache.iterdir()) == [sentinel]


@pytest.mark.skipif(shutil.which("node") is None, reason="Node is an explicit runtime dependency")
def test_failed_host_start_removes_only_its_owned_root(tmp_path):
    runtime = tmp_path / "bad-runtime"
    runtime.mkdir()
    (runtime / "host.mjs").write_text("process.stdin.once('data',()=>process.exit(1));", encoding="utf-8")
    cache = tmp_path / "cache"
    cache.mkdir()
    sentinel = cache / "unrelated"
    sentinel.write_text("keep")
    local = LocalCompiler(cache_dir=cache, runtime_dir=runtime)
    with pytest.raises(CompilerError):
        local.start()
    assert local.process_id is None
    assert local.runtime_root is None
    assert list(cache.iterdir()) == [sentinel]


@pytest.mark.skipif(shutil.which("node") is None, reason="Node is an explicit runtime dependency")
def test_close_refuses_nested_directory_link_and_preserves_external_data(tmp_path):
    import subprocess
    external = tmp_path / "external"
    external.mkdir()
    sentinel = external / "precious.txt"
    sentinel.write_text("keep external")
    local = LocalCompiler(cache_dir=tmp_path / "cache", cli_executable=tmp_path / "missing")
    local.start()
    root = local.runtime_root
    link = root / "outside-link"
    try:
        if os.name == "nt":
            result = subprocess.run(["cmd.exe", "/c", "mklink", "/J", str(link), str(external)],
                                    capture_output=True, text=True, creationflags=subprocess.CREATE_NO_WINDOW)
            assert result.returncode == 0, result.stderr
        else:
            link.symlink_to(external, target_is_directory=True)
        with pytest.raises(CompilerError, match="symbolic-link"):
            local.close()
        assert local.process_id is None
        assert sentinel.read_text() == "keep external"
        assert root.is_dir()
    finally:
        # Remove the test-created link itself without recursing into its target.
        if link.is_symlink():
            link.unlink()
        elif link.exists():
            link.rmdir()
        local.close()
    assert not root.exists()
    assert sentinel.read_text() == "keep external"

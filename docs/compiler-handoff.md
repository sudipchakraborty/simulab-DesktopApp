# Native compiler integration

`services/compiler.py` is Qt-free and uses the Python standard library.
`services/compiler_host.py` supervises the standalone Node host, copied backend
compiler modules, CLI daemon, and compiler descendants. Public APIs are documented
with Doxygen-compatible docstrings. Run blocking methods in the GUI's background
worker; progress callbacks run in that calling worker, not the Qt UI thread.

```python
from simulab_desktop.services.compiler import LocalCompiler, CompilerClient

compiler = LocalCompiler(
    # Optional, trusted installed executable/config paths:
    # node_executable=".../node.exe",
    # cli_executable=".../arduino-cli.exe",
    # config_file=".../arduino-cli.yaml",
    # cache_dir=".../private/compiler-cache",
)
compiler.start()
try:
    status = compiler.status()
    result = compiler.compile(
        "uno", [{"name": "sketch.ino", "content": "void setup(){} void loop(){}"}],
        on_progress=print, cancel_event=None,
    )
    if result["success"]:
        # AVR: prefer sketch.ino.hex, excluding .with_bootloader.hex.
        # S3: select .merged.bin, not an application-only or bootloader BIN.
        name = next(name for name in result["artifacts"] if name == "sketch.ino.hex")
        firmware = compiler.fetch_artifact({"job": result["job"], "name": name})
finally:
    compiler.close()

# An existing companion is supported with the same methods:
client = CompilerClient("http://127.0.0.1:4317", token="memory-only-token")
```

`LocalCompiler` also supports `with LocalCompiler(...) as compiler:`. `start()`
returns itself. `.client` gives its `CompilerClient`; `.process_id` is a live host
PID or `None`. `.runtime_root` is the read-only current private build directory,
or `None` before startup/after cleanup. Both expose `status`, `compile`, `fetch_artifact`, `ports`,
`libraries`, and `install_library`. No physical upload method is exposed. Library
installation is an explicit caller action and can access the network; initial
compiler startup never downloads tools or cores.

`compile` accepts a filename-to-text mapping or flat `[{name,content}]` list and
returns the real backend response, unchanged:

```json
{
  "job": "32 lowercase hexadecimal characters",
  "success": true,
  "log": "real Arduino CLI stdout/stderr",
  "diagnostics": [{"file":"sketch.ino","line":1,"column":1,"severity":"warning","message":"..."}],
  "artifacts": ["sketch.ino.hex", "sketch.ino.elf"],
  "board": "uno",
  "cached": false,
  "durationMs": 1234
}
```

The artifact download descriptor is exactly `{job: result['job'], name: filename}`;
`fetch_artifact` returns bytes without persisting them. Targets are `uno`, `nano`,
`mega2560`, `esp32`, `esp32s3`, `yd-n16r8`. `esp32` is a compile profile without an
emulator. The caller must enforce runtime target compatibility and choose merged
S3 images. A failed build normally returns `success:false` with real diagnostics;
transport/service failures raise `CompilerError`, with `.status` when available.

Progress is polled from `/compile-progress/<requestId>` while `/compile` is in
flight. Request IDs are independent random 32-hex strings. Observations retain the
actual `{percent,stage,elapsedMs,estimatedRemainingMs?}` fields. `percent:null` is
normal while the toolchain is being prepared; percentages and optional remaining
time are never invented. Very short cached builds may complete before a final
progress observation. Use the returned build result to mark completion.

Cancellation raises `CompilerCancelled` promptly, aborts both owned HTTP sockets,
and discards any eventual result. Cancelling a request to an existing external
companion does not terminate its build; it may remain busy until its own timeout.
The owned service can be closed to terminate the entire private process tree.
The UI must also keep a project/source generation ID and ignore obsolete worker
results; cancellation cannot undo a callback that the caller has already applied.

Transport defaults are 10 seconds for status/artifacts/progress, 600 seconds for a
build, and 150 ms for progress polling. All are injected keyword arguments.
`LocalCompiler` additionally accepts `startup_timeout=10`; the trusted Node runner
uses 1..1800 seconds for actual CLI work. Client timeout and cancellation include
telemetry stalls. Callbacks should return promptly. Tokens are held in memory,
sent through stdin to the private host, and never included in logs, argv, document
JSON, or persisted compiler configuration.

Only exact `http://127.0.0.1:PORT` endpoints are allowed. No redirects, DNS names,
proxies, credentials-in-URLs, paths, or query strings are accepted. Source projects
require 1..32 flat Arduino source/header files including `sketch.ino`; duplicate,
reserved Windows, traversal, NUL, malformed Unicode, and over-1 MB inputs fail
before HTTP. JSON responses are capped at 4 MiB and artifacts at 32 MiB. Trusted
local compilation is not an OS sandbox for arbitrary untrusted C/C++ includes.

CLI discovery order is injected path, `ARDUINO_CLI`, PATH, then known existing
`.local` installation directories (including sibling `simulab-backend/.local`).
Config discovery is injected path, `ARDUINO_CONFIG`, then `arduino-cli.yaml` beside
the selected CLI. This is installation discovery only: the application never
imports sibling code. With no CLI, the private host still starts and reports
`available:false` with setup instructions. With no Node executable, `start()`
raises an actionable `CompilerError`. Default build/cache storage is
`%LOCALAPPDATA%/SimuLabDesktop/compiler` (or the user's cache folder), separate from
documents and packaged resources. `cache_dir` remains the configured parent;
every `start()` creates a distinct private `host-*` child, with no token in its
name or contents. Concurrent application/host instances therefore never share a
source workspace, incremental cache, artifact cache, or retained job directory.
The backend validates files, board, compiler/core/library fingerprints, and exact
cache entries; no client firmware cache can bypass it.

Exact and incremental cache reuse lasts while that host stays open. On `close()`,
the service first stops all owned descendants, then deletes only its own root.
Starting again creates a new root and rebuilds current source; this deliberately
trades reuse across restarts for source isolation and bounded normal-lifetime
disk retention. Unrelated files in the configured parent survive. Startup
failures also remove their owned directory. Cleanup checks canonical containment,
directory identity, and symbolic-link/reparse escapes before recursive removal;
if ownership changed, it raises an actionable error and retains the directory.
An abrupt OS/Python crash can leave a private directory for manual inspection
and removal after the process tree is confirmed stopped; startup never deletes
unrelated or previous-instance directories by guessing ownership.

The host binds `127.0.0.1` on an OS-selected port and accepts no browser origins.
Windows Job Object kill-on-close owns all descendants before the host receives
its configuration. Node and CLI processes launch without a shell or visible
console. Host shutdown closes connections and the compiler daemon; Python closes
the owned process job as the final descendant cleanup. POSIX uses a private
session/process group. `compiler_runtime/provenance.json` pins unchanged copied
module hashes; `compiler_runtime/NOTICE.md` records source/license boundaries.

## Verified evidence, 2026-11-26

The first test invocation failed with the expected missing compiler module. The
initial 20 fixture tests then passed. A separate failing regression exposed a
2-second cancellation delay when telemetry stalled; independent cancellable
telemetry now keeps cancellation prompt. A process lifecycle check additionally
starts a real Node grandchild, lets its host exit gracefully, and confirms the
grandchild is terminated by ownership cleanup.

Final review identified shared-root corruption across hosts: a deterministic
real-companion fixture made both hosts wait until their different sources were
written, then resumed both compiler adapters. Before isolation, both downloads
contained the same corrupted source bytes. Regression tests now verify distinct
host roots, each host's own downloaded source, cleanup/restart uniqueness,
startup-failure cleanup, unrelated-data preservation, and safe refusal of a
nested Windows junction pointing outside the owned root. Final focused run:
**26 passed**. The compiler-only follow-up did not rerun unrelated UI/runtime tests.

Real builds used installed Arduino CLI **1.5.1**, the bundled standalone host,
and a fresh temporary app-owned cache. The source drove Uno D13 and printed a
serial literal. The changed build replaced `native desktop one` with
`native desktop two`; this changed compiled firmware bytes.

| Build | Real wall time | Backend duration | Exact cache | HEX bytes | SHA-256 |
| --- | ---: | ---: | --- | ---: | --- |
| Fresh cache | 33.718 s | 33616 ms | false | 5565 | `5aca18e081faeabd06cc4d82944b16fb2c2877a229403a955c6331ebc45c2f0c` |
| Identical source | 0.402 s | 370 ms | true | 5565 | `5aca18e081faeabd06cc4d82944b16fb2c2877a229403a955c6331ebc45c2f0c` |
| Changed source | 4.944 s | 4875 ms | false | 5565 | `5b3cce21569520d618d4d024af307e50a9eef3a72ba5947549be99be90450734` |

Fresh build: 212 actual telemetry observations, beginning with null percent and
reaching 100%; changed build: 31 observations including actual 12, 20, 32, 68, 80,
100 percent readings. The identical build completed before a final telemetry
sample; its successful returned result and exact firmware hash establish reuse.
The owned host PID 50464 and Arduino daemon were absent after close. No physical
board upload or hardware behavior was tested by this compiler work package.

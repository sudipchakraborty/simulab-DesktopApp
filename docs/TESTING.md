# Verification — 2026-11-26

Use `.venv\Scripts\python.exe`; system Python is an unrelated embedded installation. Final suite: **79 passed, 12 subtests passed in 24.81s**. The final suite/package record is in [progress.md](../progress.md).

Coverage includes malformed/oversized/nonfinite imports, explicit crossings/shared pads, all examples, atomic save failure, history/group edits/plugins, real AVR/Nano/Mega execution, official S3 boot/GPIO/input, wired instruments, target/session/protocol bounds, speed/pacing, standalone copied assets, private compiler auth/progress/cancellation/descendant cleanup, native source/manual ownership and UI review regressions.

## Real custom-source native smoke

`scripts/verify_native.py` passed with Qt offscreen:

- Compiled new Uno source and observed unique `NATIVE CODE BUILD` / `NATIVE HIGH` UART through a wired native instrument:26.945s first run,11 progress samples, code ownership.
- Paused actual AVR and inspected32 registers at640001 cycles / PC byte422; reset returned time to0; restart emitted its message again.
- Saved native circuit+source and verified serialization.
- Booted official S3/MicroPython, sent a wired console command that set GPIO4, observed `NATIVE S3 GPIO 1`.
- Native event-loop heartbeat continued:499 ticks, maximum observed gap274.24ms.

Machine-readable evidence/screenshots are in ignored `artifacts/`. Independent compiler evidence:33.718s fresh,0.402s identical verified cache (same SHA-256),4.944s changed source (different SHA-256). Toolchain files and physical hardware were not modified/uploaded. Per-host compiler isolation now limits retained build cache to that live host.

## Performance

Native offscreen Windows11/Python3.13.3/Qt6.12 benchmark at1200×750: startup to Qt~0.99s;10/100/1000-part loads~6.5/39.5/422ms. Stable repeated projection medians~0.016/0.125/1.954ms. First changed frame for1000 parts reached188.946ms; stable-state results do not establish30Hz with1000 changing devices. Screenshot capture is a separate cost.

Actual equivalent Uno workload, three1000ms samples each: native maximum11.11Mcycles/s, native real-time mode10.82M, browser worker7.02M. Maximum was1.58× that browser-worker throughput under concurrent load; both remained below real time. Pause median13.7ms, frames23.6Hz. Script: `node scripts/benchmark_engine.mjs --browser --samples 3 --duration-ms 1000`. It launches/closes its own temporary Vite/Chromium and preserves genuine firmware/UART/hash evidence. This is one workload, not a whole-app/universal speed guarantee.

Run the normal Python suite, native smoke (requires installed Arduino toolchain), scene benchmark and engine benchmark using README commands. All execution evidence is software-only; existing analog/protocol/debug/model limits remain.

Final post-review repeat: native custom-source smoke passed in 14.173s with 9 progress observations and real AVR/S3 results. Native maximum benchmark 14.08M cycles/s vs browser 8.31M, about 1.70x this workload (native pause median 6.08ms). The frozen Windows GUI exited 0 after screenshot capture; its own packaged engines produced actual AVR UART and S3 boot without sibling sources. The wheel and Windows folder both built successfully. Doxygen was unavailable, so documentation HTML was not generated.

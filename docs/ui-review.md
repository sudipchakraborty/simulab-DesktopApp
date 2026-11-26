# Native UI integration review — 2026-11-26

Scope: read-only review of main-window composition, canvas/editor/panels and Qt
runtime supervision against the native design and implementation plan. No
application source was modified. Short offscreen Qt checks isolated user-visible
behaviors; completed core/compiler/CPU integration suites were not rerun. Root
integration fixes were landing concurrently, so resolved findings are separated
below.

## Confirmed findings

1. **P1 — compiler startup can finish after the window closes.**
   `ui/main_window.py:673–680` creates/starts the service in a worker without a
   closing/generation check or startup lock. `closeEvent`, lines 894–899, closes
   the service once but does not coordinate with a startup already in flight.
   Reproduction: inject a compiler whose `start()` waits on an event; invoke
   `_check_compiler()`, wait until startup enters, close the window, then release
   startup. Observed `window_closing=True`, `compiler_live=True`, `close_calls=1`.
   The same ordering exists if a real startup is paused before process creation:
   closing an as-yet unstarted service cannot terminate the child created later.
   Toolchain status requests also remain available during Build, so simultaneous
   calls can enter the non-thread-safe `LocalCompiler.start()` on one object.
   Coordinate construction/start/close and prevent post-close result delivery;
   a late successful startup must immediately dispose its owned service.

2. **P2 — synchronous runtime preflight failure is overwritten by Loading.**
   `services/runtime.py:42–51` emits `failed` synchronously when Node or the
   packaged bridge is absent. `ui/main_window.py:593–596` calls that transport
   and then unconditionally writes `Loading genuine firmware…`. Reproduction:
   place Uno, set `window.runtime.node=None`, then Load reference firmware.
   Observed internal `runtime_state='error'` but visible label
   `Loading genuine firmware…`; the event log contains the actual missing-Node
   error followed by a misleading Loading entry. Preserve the preflight error
   state and avoid issuing a successful-load presentation after failed startup.

3. **P2 — native AVR onboard LED artwork never follows D13.**
   `ui/canvas.py:145` paints the controller indicator from `item.lit`, while
   `apply_projection`, lines 379–391, assigns that value only from `ledStates`.
   The runtime projection's `ledStates` contains standalone LED component IDs;
   controller values are in `pinStates`. Reproduction: open a single-controller
   Nano/Mega Blink example and execute Blink; its D13 pin square can change while
   the depicted onboard LED stays dark. A targeted rendering check supplied
   `pinStates={board_id:{'D13':1}}`: the pin became `#44d7b6` but board `lit` stayed
   false (now unknown after the adjacent null-state fix). Derive AVR onboard
   state from the actual resolved D13 value. Keep unsupported S3 onboard RGB
   behavior explicit rather than treating GPIO48 snapshots as decoded RGB.

4. **P3 — double-click wire junction is displaced from the clicked point.**
   `ui/canvas.py:239–241,373–375` passes the clicked scene coordinates as a new
   junction's component origin. Its actual terminal is offset by half the
   48-by-48 artwork (`canvas.py:90`). A targeted scene check split a wire at
   `(100,100)` and observed the new `J` endpoint at `(124,124)`. The wire visibly
   jumps away from the requested location. Translate the pointer location to the
   junction component's local origin, or define junction artwork/pin at `(0,0)`.

## Findings addressed during review

- **Compiler target with preserved custom source:** pasting custom S3 source into
  a blank workspace and placing an S3 board left the target at Uno. Root moved
  target selection outside the blank-source condition in `place_component`;
  source text remains protected. The initial targeted check confirmed the old
  failure; the final integration tests should cover the fix.
- **Deleted source file with imported breakpoints:** closing `x.h` while its
  imported breakpoint entry remained caused Save/Autosave to raise
  `ValueError: Invalid breakpoints`. Root now filters breakpoints against the
  remaining filenames in `_sync_sources`. The initial targeted check confirmed
  the failure before that change.
- **Stale lit standalone LED on unknown/floating state:** after a true sample,
  a null `ledStates` sample retained `lit=True`. Root changed projection updates
  to retain unknown explicitly instead of keeping the old illuminated value.

## Checks that did not reveal a defect

Circuit commits/open/new/undo clear pending autostart and invalidate firmware
sessions. Source edits invalidate code-owned firmware while preserving explicitly
loaded manual firmware. Runtime messages are session-filtered by the adapter.
The canvas maintains identified pins across movement/rotation; group positions
commit through one immutable project edit. Copy clones only selected components
and their internal wires with fresh IDs. Portable saves use the core atomic
writer. No physical upload occurs in these reviewed UI paths.

This review does not claim real-board parity or a comparative browser/native
performance result. Root owns regression fixes and final verification evidence.

# Final engineering review — 2026-11-26

Scope: read-only review of the Python core, service/runtime contracts, packaging
paths, plugin aliases, secret persistence and copied compiler host against the
native design/plan. Production code and tests were not edited. Findings from
`ui-review.md` that already have fixes/regressions were not repeated. The new
speed command was still being finalized by its owner and is outside this review.

## Confirmed findings

### P1 — Concurrent compiler hosts can compile another project's source

Locations: `services/compiler_host.py:70–71,132`,
`compiler_runtime/service.mjs:49–54,234–246`,
`compiler_runtime/build-cache.mjs:109–125`.

`LocalCompiler` uses one persistent default root, and every ordinary window also
passes the same `data_dir / "compiler"` root. Each host's `busy` flag protects
only that host. Two hosts therefore write the same
`workspaces/<board>/sketch` and `cache/<board>` paths concurrently. Host A can
prepare project A, then compile project B after host B rewrites the shared sketch.
The response and exact artifact-cache key still describe A's submitted source.
This can run different firmware than the source displayed in the requesting
window, as well as corrupt the shared incremental build directory.

Targeted reproduction used two actual `createCompanion` HTTP servers sharing one
fresh temporary root, with injected tool runners and an unchanged toolchain
fingerprint. Runner A paused after `prepareWorkspace`; server B compiled source
`project B source`; runner A then resumed and read `sketch.ino`. Observed:

```json
{"observed":[{"owner":"B","source":"project B source"},{"owner":"A","source":"project B source"}],"aSuccess":true,"bSuccess":true,"aArtifacts":["sketch.ino.hex"]}
```

This check demonstrates the source ownership race without uploading or executing
physical hardware. Give each host an exclusive workspace/build root, or enforce
an interprocess lock across every operation that reads/mutates a shared root.
Merely retaining per-host HTTP serialization does not cover separate windows.

### P2 — A valid controller engine alias cannot execute through the native UI

Locations: `ui/main_window.py:378–380,588–592`;
`core/registry.py:138–158` defines the successful alias contract.

The registry explicitly accepts any built-in `engineKind` with identical pin IDs,
but `_target()` recognizes only literal built-in kinds. A plugin registered as
`custom-uno` using a copied Uno definition plus `engineKind="uno"` maps correctly
through `registry.engine_project()`, yet Build, Run and manual/reference loading
all fail before that mapping with “Execution requires exactly one supported
controller in the circuit.” Placement also misses controller starter/profile
selection for the alias.

Targeted offscreen reproduction:

```python
definition = registry.get("uno")
definition["engineKind"] = "uno"
registry.register("custom-uno", definition)
document = new_workspace(registry)
document["circuit"]["components"] = [registry.create("custom-uno")]
# registry.engine_project(document["circuit"]) maps the part to "uno".
window._set_document(document, dirty=False)
window._target()  # raises ValueError instead of returning "uno"
```

Resolve effective controller kinds through the injected registry consistently
for target detection and placement, retaining the native kind in saved data.

### P2 — Persistent build artifacts escape the advertised retention bounds after restart

Locations: `compiler_runtime/service.mjs:49–52,224–233`;
`compiler_runtime/build-cache.mjs:131–140`;
`services/compiler_host.py:70–71` supplies the persistent root.

The job and exact-cache retention/pruning metadata exists only in in-memory
Maps. A fresh host forgets every prior directory, so its 10-entry/byte/expiry
bounds never visit prior jobs or artifact-cache entries. Normal application
restarts retain old firmware, build logs and source workspaces indefinitely;
new sessions add more directories without reclaiming the forgotten artifacts.

A targeted check started 12 consecutive real companion HTTP servers against one
temporary persistent root, compiling one distinct tiny source through each
injected runner and closing each server before the next. It observed:

```json
{"hostStarts":12,"retainedJobDirectories":12,"retainedArtifactCacheEntries":12}
```

Restore/prune durable metadata or remove exclusively owned session directories
on close/startup. Any cleanup must respect the concurrent-host ownership issue
above rather than deleting another live host's files.

## Checked boundaries and limits

- Portable serialization constructs an allowlisted workspace and strips root
  runtime/token/artifact fields. Atomic document saves validate before replacing
  the destination. No pairing-token persistence defect was found in these paths.
- Runtime resources and compiler modules resolve beside the installed package;
  existing Arduino installations are discovered optionally. No required sibling
  source import was found in execution paths. Development import tooling uses
  sibling sources explicitly.
- Compiler HTTP uses an ephemeral numeric-loopback endpoint with an in-memory
  credential, exact Host/Origin restrictions and no redirect following. Review
  found no implicit physical upload in the native UI paths.
- Document schema/model numeric bounds agree with the corresponding bundled
  parser for the expanded models inspected. Unsupported engine/physical behavior
  remains explicit in design/help/capabilities.
- Only the three targeted checks described above were run for this review. The
  full suite, packaging smoke and genuine firmware verification belong to the
  root integration evidence; this document does not claim those were rerun.

# Review resolutions — 2026-11-26

All concrete findings in `ui-review.md` and `final-review.md` have been addressed. Those documents retain the original reproductions as historical evidence.

| Finding | Final behavior / regression evidence |
|---|---|
| Concurrent compiler roots can compile another window's source | Each host has an exclusive owned root; deterministic concurrent-source test verifies distinct output bytes |
| Persistent artifact retention across ordinary restarts | Normal close/startup failure cleans the verified owned root after descendants stop; sentinel/junction/identity tests guard cleanup |
| Controller aliases ignored by UI | Effective kind selects controller target, starter/profile, renderer and onboard state; native custom kinds stay saved |
| Alias on bare circuit import | Core derives the correct compiler profile and supports explicit alias starters |
| Compiler startup after window closure / simultaneous startup | Worker-side lock and before/after closing checks serialize startup and close late children; post-close callbacks suppressed |
| Missing runtime overwritten by Loading | Error remains visible and failed loads lose ownership |
| Custom source prevented controller profile selection | Source is preserved while target selection follows the placed controller |
| Deleted file retained invalid breakpoints | Breakpoints are pruned to remaining source names before persistence |
| LED retained previous HIGH after unknown | Unknown projection clears illuminated state |
| AVR onboard LED ignored actual D13 | Indicator derives from actual resolved D13; S3 RGB remains unsupported |
| Split-wire junction moved from clicked point | Junction pin/artwork origin is its exact stored position |

Final integrated verification: **79 passed, 12 subtests passed in 24.81s**. The real custom-source/native firmware smoke also passed after these fixes (14.173s compile-to-UART; real AVR registers/reset/restart, saved source and S3 console GPIO).

Decision and cost: compiler exact/incremental reuse is retained during one host lifetime. New application sessions rebuild into exclusive roots, avoiding cross-project corruption and forgotten normal-close artifacts. Abrupt host/application termination can retain an owned private directory; normal cleanup and startup-failure cleanup are tested. No source or artifact is shared between live hosts.

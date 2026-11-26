# SimuLab Desktop contributor instructions

- Read and update `progress.md` for every substantive change; record actual tests and remaining limits.
- Keep Python core Qt-free. Initialize reusable modules with explicit parameters and document public APIs with Doxygen-compatible `@brief`, `@param`, and `@return` docstrings.
- This is a native Python/Qt application. Real MCU/model execution is isolated behind the versioned local runtime process protocol; no synthetic firmware output or silent board fallback.
- Preserve portable browser circuit/workspace schemas; custom plugin kinds require their plugin when reopening.
- Wires connect named endpoints/junctions. Drawing crossings alone never form a connection.
- Never save pairing tokens or firmware artifacts inside workspace JSON.
- Do not modify sibling repositories, publish or push without authorization.
- Verify actual firmware and relevant native interactions before completion claims. Be explicit about unsupported analog, firmware, debugging and hardware behavior.
- Give an audible completion beep when supported.

# Compiler source provenance

The eight `.mjs` files listed in `provenance.json` are unchanged copies of
`simulab-backend/src` at commit `21f28263086e4d08ca30209b28a1277c8a20c9b6`.
They belong to the existing SimuLab project. The source checkout did not contain a
LICENSE, COPYING, NOTICE file, or package license declaration. This copy does not
add a license or grant redistribution rights. Retain project ownership/permission
requirements when distributing this application.

`host.mjs` is the native desktop adapter. It uses only Node built-ins and the
copied modules. No accounts, mail transport, npm dependency, `node_modules`, or
sibling repository is required at runtime.

Arduino CLI and installed AVR/ESP32 platforms are external tools and are not
copied into this package. They keep their upstream licenses and notices at their
installation locations. The application discovers existing installations or
accepts explicitly injected paths; it does not download/install toolchains.

# Browser audit and migration map

The audit covered browser composition, portable documents/editing, complete catalogue/model host, actual AVR/S3 workers, instrument routing, IDE/compiler contracts, layout/theme and account boundaries. Imported implementation commits/input hashes are pinned in `resources/provenance.json`; compiler provenance is separate.

| Browser area | Native treatment |
|---|---|
| React/XYFlow App/editor | Replaced by Python Qt MainWindow, Graphics View and docks |
| Circuit/IDE workspace | Python strict circuit1.0–1.4/workspace1.0 import/export |
| Catalogue/categories/boards | All33 definitions, physical+virtual pins, defaults and four starters exported |
| Netlist/editing/selection/store | Python immutable edits/history/ERC; original execution-domain topology bundled |
| AVR worker | Actual headless AVR CPU, exact GPIO/before-read/I2C callbacks and cycle time |
| ESP worker | Official JS/WASM initialized from disk; merged S3 firmware |
| Models/factory/CircuitRuntime | Framework-free behavioral implementations reused with original limitations |
| Instrument sessions/connections | Actual wiring/interlocks reused behind native UART/debug views |
| Monaco/IDE | Native multifile C/C++ editor; artifacts excluded from documents |
| ToolchainClient/backend | Qt-free transport and private independently bundled companion |
| SVG component visuals | Native scalable schematic QPainter graphics and real projected pin/device state |
| Browser layout/themes/storage | Qt docks/splitter/palette and local recovery/settings |
| Accounts/subscriptions/payments | Outside offline desktop engineering scope; private server data untouched |
| Physical upload | Not exposed by this release |

Families include Uno/Nano/Mega/S3, primitives, DS3231/multiplexer/motor/WS2812/relay/H-bridge, meters, HX711/DHT22/optical modules, stepper/driver/servo, switches, robotic arms/conveyor/car and wired serial/debug instruments. Their behavioral code is preserved, rather than reconstructed from animation.

Original graphics are inline TSX/SVG. Native views are schematic and do not establish physical-board geometry/analog accuracy. Genuine execution, visual representation, unsupported adapters and physical hardware verification remain distinct.

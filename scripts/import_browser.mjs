/** @file Reproduce the standalone desktop engine/resources from explicit browser/engine source roots.
 * @details This is a development-time importer. Installed desktop applications never read source repositories.
 */
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve, dirname, relative, join } from "node:path";
import { readFile, writeFile, mkdir, copyFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index < 0 ? fallback : resolve(args[index + 1]);
};
const frontend = option("--frontend", resolve(desktop, "../simulab-frontend"));
const engine = option("--engine", resolve(desktop, "../simulab-engine"));
const destination = resolve(desktop, "src/simulab_desktop/resources");
const require = createRequire(join(frontend, "package.json"));
const { build } = require("esbuild");
await mkdir(destination, { recursive: true });

const from = (root, path) => JSON.stringify(join(root, path).replaceAll("\\", "/"));
const source = `
export { AvrRuntime, UnoRuntime, ENGINE_CONTRACT_VERSION, capabilities } from ${from(engine, "src/index.ts")};
export { Esp32S3Runtime } from ${from(engine, "esp32/adapter.mjs")};
export { CircuitRuntime } from ${from(frontend, "src/models/circuitRuntime.ts")};
export { parseProject, createSampleProject } from ${from(frontend, "src/circuit/project.ts")};
export { catalog, componentPins } from ${from(frontend, "src/circuit/catalog.ts")};
export { componentCategory } from ${from(frontend, "src/circuit/categories.ts")};
export { createYdExample } from ${from(frontend, "src/circuit/yd-example.ts")};
export { createComponentsExample } from ${from(frontend, "src/circuit/components-example.ts")};
export { controllerStarter } from ${from(frontend, "src/ide/boardStarter.ts")};
export { newWorkspace, parseWorkspace } from ${from(frontend, "src/ide/workspace.ts")};
export { projectSignals } from ${from(frontend, "src/simulation/projection.ts")};
export { buttonInputs } from ${from(frontend, "src/simulation/buttonInputs.ts")};
export { controllerPinStates } from ${from(frontend, "src/simulation/controllerPinStates.ts")};
export { simulationTarget } from ${from(frontend, "src/simulation/targets.ts")};
export { InstrumentSession } from ${from(frontend, "src/instruments/session.ts")};
export { InstrumentRequestError } from ${from(frontend, "src/instruments/types.ts")};
`;
const output = join(destination, "engine.mjs");
const built = await build({
  stdin: { contents: source, resolveDir: desktop, sourcefile: "desktop-domain-entry.mjs" },
  outfile: output, bundle: true, platform: "node", target: "node22", format: "esm",
  legalComments: "eof", metafile: true,
});
const domain = await import(pathToFileURL(output).href + "?import=" + Date.now());
const catalogue = Object.fromEntries(Object.entries(domain.catalog).map(([kind, definition]) => [kind, {
  ...definition, kind, category: domain.componentCategory(kind),
  pins: domain.componentPins(kind),
}]));
await writeFile(join(destination, "catalog.json"), JSON.stringify(catalogue, null, 2) + "\n");
const boards = ["uno", "nano", "mega2560", "yd-esp32-s3"];
await writeFile(join(destination, "starters.json"), JSON.stringify(Object.fromEntries(
  boards.map(kind => [kind, domain.controllerStarter(kind)])), null, 2) + "\n");

/** @brief Assign deterministic identities to generated example wires for reproducible imports. */
function portableExample(project) {
  project.wires = project.wires.map((wire, i) => ({ ...wire, id: `wire-${i + 1}` }));
  return domain.newWorkspace(project);
}
await mkdir(join(destination, "examples"), { recursive: true });
for (const [name, project] of [
  ["uno-blink", domain.createSampleProject()],
  ["esp32s3-gpio4", domain.createYdExample()],
  ["component-laboratory", domain.createComponentsExample()],
]) {
  const workspace = portableExample(project);
  if (name === "component-laboratory")
    workspace.files[0].content = await readFile(join(frontend, "public/examples/components/sketch.ino"), "utf8");
  await writeFile(join(destination, "examples", name + ".json"), JSON.stringify(workspace, null, 2) + "\n");
}
for (const kind of ["nano", "mega2560"]) {
  const project = { schemaVersion: "1.4.0", name: domain.catalog[kind].name + " Blink", wires: [], components: [{
    id: "mcu", kind, label: domain.catalog[kind].name, position: { x: 0, y: 0 }, rotation: 0,
    properties: { ...domain.catalog[kind].defaultProperties },
  }] };
  await writeFile(join(destination, "examples", kind + "-blink.json"), JSON.stringify(domain.newWorkspace(project), null, 2) + "\n");
}

/** @brief Copy a resource without altering the pinned upstream bytes. */
async function copy(sourceRoot, sourcePath, destinationPath = sourcePath) {
  const target = join(destination, destinationPath);
  await mkdir(dirname(target), { recursive: true });
  await copyFile(join(sourceRoot, sourcePath), target);
}
for (const name of await readdir(join(frontend, "public/firmware")))
  await copy(join(frontend, "public"), "firmware/" + name);
for (const name of await readdir(join(frontend, "public/emulators/esp-emu-0.51.0")))
  await copy(join(frontend, "public"), "emulators/esp-emu-0.51.0/" + name);
await writeFile(join(destination, "emulators/esp-emu-0.51.0/package.json"), '{"type":"module"}\n');
await copy(engine, "THIRD_PARTY_NOTICES.md", "licenses/THIRD_PARTY_NOTICES.md");
await copy(engine, "esp32/licenses/ESP-EMU-LICENSE.txt", "licenses/ESP-EMU-LICENSE.txt");
await copy(engine, "esp32/licenses/MICROPYTHON-LICENSE.txt", "licenses/MICROPYTHON-LICENSE.txt");
await copy(engine, "node_modules/avr8js/LICENSE", "licenses/AVR8JS-LICENSE.txt");
await copy(engine, "esp32/asset-manifest.json", "licenses/upstream-assets.json");

const hash = bytes => createHash("sha256").update(bytes).digest("hex");
function revision(root) {
  return { commit: execFileSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    dirty: Boolean(execFileSync("git", ["-C", root, "status", "--porcelain"], { encoding: "utf8" }).trim()) };
}
const files = {};
async function collect(directory) {
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await collect(path);
    else if (entry.name !== "provenance.json") {
      const bytes = await readFile(path);
      files[relative(destination, path).replaceAll("\\", "/")] = { bytes: bytes.length, sha256: hash(bytes) };
    }
  }
}
await collect(destination);
const inputs = {};
for (const filename of Object.keys(built.metafile.inputs).sort()) {
  if (filename === "desktop-domain-entry.mjs") continue;
  const path = resolve(filename);
  const prefix = path.startsWith(frontend) ? "frontend/" : path.startsWith(engine) ? "engine/" : "dependency/";
  const root = path.startsWith(frontend) ? frontend : path.startsWith(engine) ? engine : desktop;
  inputs[prefix + relative(root, path).replaceAll("\\", "/")] = hash(await readFile(path));
}
await writeFile(join(destination, "provenance.json"), JSON.stringify({
  schemaVersion: "1.0.0", description: "Standalone imported SimuLab browser domain; no browser UI included",
  sources: { frontend: revision(frontend), engine: revision(engine) },
  tools: { esbuild: require("esbuild/package.json").version }, inputs, files,
  distributionLicense: "No project-wide SimuLab distribution license selected; preserve upstream notices",
}, null, 2) + "\n");
console.log(`Imported ${Object.keys(catalogue).length} component kinds, ${Object.keys(files).length} resources into ${destination}`);

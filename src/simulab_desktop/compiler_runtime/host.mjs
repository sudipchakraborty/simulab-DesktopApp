/** @file Private compiler host. Configuration/token arrive once on stdin, never in argv/logs. */
import { createInterface } from 'node:readline';
import { isAbsolute } from 'node:path';
import { createCompanion } from './service.mjs';
import { commandRunner } from './runner.mjs';

const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
let configured = false, server, runner, stopping = false;
const stop = async () => {
  if (stopping) return;
  stopping = true;
  input.close();
  try { server?.closeAllConnections(); server?.close(); await runner?.close?.(); }
  finally { process.exit(0); }
};
input.on('line', (line) => {
  void (async () => {
    if (Buffer.byteLength(line) > 16384) throw new Error('Configuration exceeds limit');
    const value = JSON.parse(line);
    if (configured) {
      if (value.type !== 'shutdown') throw new Error('Unknown host operation');
      await stop();
      return;
    }
    configured = true;
    if (typeof value.token !== 'string' || !/^[a-f0-9]{64}$/.test(value.token)
        || typeof value.root !== 'string' || !isAbsolute(value.root)
        || !Number.isInteger(value.timeoutMs) || value.timeoutMs < 1000 || value.timeoutMs > 1800000
        || (value.executable !== null && (typeof value.executable !== 'string' || !isAbsolute(value.executable)))
        || (value.configFile !== null && (typeof value.configFile !== 'string' || !isAbsolute(value.configFile)))) {
      throw new Error('Invalid host configuration');
    }
    process.env.SIMULAB_TOOLCHAIN_TIMEOUT_MS = String(value.timeoutMs);
    // Use the real streamed RPC transport regardless of unrelated shell configuration.
    process.env.SIMULAB_COMPILER_TRANSPORT = 'grpc';
    if (value.executable) runner = commandRunner(value.executable, value.configFile);
    else {
      const message = 'Arduino CLI was not found. Install Arduino CLI and board cores, then set ARDUINO_CLI and ARDUINO_CONFIG or pass explicit toolchain paths.';
      runner = async () => ({ code: 127, stdout: message, stderr: '' });
      runner.fingerprint = async () => { throw new Error(message); };
    }
    server = createCompanion({ token: value.token, origins: [], root: value.root, runner });
    server.on('error', () => { void stop(); });
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      process.stdout.write(JSON.stringify({ type: 'ready', protocol: 1, port: address.port }) + '\n');
    });
  })().catch(() => { process.exitCode = 1; void stop(); });
});
input.on('close', () => { if (!stopping) void stop(); });
process.on('SIGINT', () => { void stop(); });
process.on('SIGTERM', () => { void stop(); });
// Parent disappearance closes stdin. Windows Job Object/POSIX group ownership is
// also enforced by Python, including abrupt host termination during compilation.

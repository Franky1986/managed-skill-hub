import { closeSync, openSync } from 'node:fs';
import { spawn } from 'node:child_process';

const [logFile, command, ...args] = process.argv.slice(2);

if (!logFile || !command) {
  console.error('Usage: node start-detached.mjs <log-file> <command> [args...]');
  process.exit(2);
}

const logFd = openSync(logFile, 'w');
const child = spawn(command, args, {
  cwd: process.cwd(),
  detached: true,
  env: process.env,
  stdio: ['ignore', logFd, logFd],
});

try {
  await new Promise((resolve, reject) => {
    child.once('spawn', resolve);
    child.once('error', reject);
  });
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  closeSync(logFd);
}

if (process.exitCode !== 1) {
  child.unref();
  process.stdout.write(`${child.pid}\n`);
}

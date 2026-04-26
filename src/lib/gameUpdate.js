import { spawn } from 'node:child_process';

// Hard-coded script path — matches the exact path granted in the sudoers file.
// No arguments are accepted or forwarded; sudoers whitelists this exact argv.
export const GAME_UPDATE_SCRIPT = '/opt/squad/Skripte/GameUpdate.sh';

const MAX_OUTPUT_BYTES = 256 * 1024;
// SteamCMD downloads can be slow on constrained links; 20 min is a safe upper bound
// that still prevents a runaway process from hanging the bot indefinitely.
const DEFAULT_TIMEOUT_MS = 20 * 60 * 1000;

export async function runGameUpdate({ onProgress } = {}) {
  return new Promise((resolve) => {
    const child = spawn('/usr/bin/sudo', ['-n', GAME_UPDATE_SCRIPT], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let truncated = false;
    let timedOut = false;

    const append = (target, chunk) => {
      const text = chunk.toString('utf8');
      const current = target === 'stdout' ? stdout : stderr;
      const remaining = MAX_OUTPUT_BYTES - current.length;
      if (remaining <= 0) {
        truncated = true;
        return;
      }
      const slice = text.length > remaining ? text.slice(0, remaining) : text;
      if (slice.length < text.length) truncated = true;
      if (target === 'stdout') stdout += slice;
      else stderr += slice;
      if (onProgress) {
        try {
          onProgress({ stream: target, chunk: slice, stdout, stderr });
        } catch {
          // Progress reporter must never break the run.
        }
      }
    };

    child.stdout.on('data', (c) => append('stdout', c));
    child.stderr.on('data', (c) => append('stderr', c));

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, DEFAULT_TIMEOUT_MS);

    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ ok: false, code: -1, stdout, stderr: stderr || String(err.message ?? err), truncated, timedOut });
    });

    child.on('close', (code, signal) => {
      clearTimeout(timer);
      const exitCode = typeof code === 'number' ? code : -1;
      const ok = !timedOut && exitCode === 0;
      const finalStderr = timedOut
        ? `${stderr}\n[killed after ${DEFAULT_TIMEOUT_MS / 1000}s timeout, signal=${signal ?? 'SIGTERM'}]`
        : stderr;
      resolve({ ok, code: exitCode, stdout, stderr: finalStderr, truncated, timedOut });
    });
  });
}

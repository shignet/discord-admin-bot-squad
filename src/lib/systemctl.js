import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { config } from '../config.js';
import { assertAllowedAction, assertAllowedService } from './systemctlGuard.js';

const execFileAsync = promisify(execFile);

const MAX_OUTPUT_BYTES = 64 * 1024;
const DEFAULT_TIMEOUT_MS = 15_000;

export async function runSystemctl(action, service) {
  assertAllowedAction(action);
  assertAllowedService(service, config.squadServices);

  // execFile with an argument array — no shell, no interpolation, no injection surface.
  // The sudoers file restricts this user to exactly the combinations we also validate here.
  try {
    const { stdout, stderr } = await execFileAsync(
      '/usr/bin/sudo',
      ['-n', '/bin/systemctl', action, service],
      { timeout: DEFAULT_TIMEOUT_MS, maxBuffer: MAX_OUTPUT_BYTES },
    );
    return { ok: true, code: 0, stdout, stderr };
  } catch (err) {
    // systemctl returns non-zero for stopped units on `status`; keep the output so the command can show it.
    return {
      ok: false,
      code: typeof err.code === 'number' ? err.code : -1,
      stdout: err.stdout ?? '',
      stderr: err.stderr ?? String(err.message ?? err),
    };
  }
}

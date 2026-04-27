// src/lib/gameupdate.js
// execFile-based wrappers for the squad-gameupdate systemd services.
// Design mirrors systemctl.js: no shell strings, every argv combination is explicit,
// and the matching sudoers lines are in systemd/sudoers.d-discord-admin-bot-squad.

import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { assertAllowedInstance } from './gameUpdateGuard.js';

const execFileAsync = promisify(execFile);

// SteamCMD downloads can be large — allow up to 25 minutes.
const UPDATE_TIMEOUT_MS = 25 * 60 * 1_000;
const SHOW_TIMEOUT_MS = 5_000;
const MAX_BUFFER = 64 * 1024;

// ---------------------------------------------------------------------------
// Instance update  (squad-gameupdate@<instance>.service)
// ---------------------------------------------------------------------------

/**
 * Starts the squad-gameupdate@<instance>.service oneshot and blocks until it
 * exits.  Returns { ok, code, stdout, stderr }.
 *
 * The matching sudoers line is:
 *   discord ALL=(root) NOPASSWD: /bin/systemctl start --wait squad-gameupdate@<instance>.service
 */
export async function startInstanceUpdate(instance, allowedInstances) {
  assertAllowedInstance(instance, allowedInstances);

  const service = `squad-gameupdate@${instance}.service`;

  try {
    const { stdout, stderr } = await execFileAsync(
      '/usr/bin/sudo',
      ['-n', '/bin/systemctl', 'start', '--wait', service],
      { timeout: UPDATE_TIMEOUT_MS, maxBuffer: MAX_BUFFER },
    );
    return { ok: true, code: 0, stdout, stderr };
  } catch (err) {
    return {
      ok: false,
      code: typeof err.code === 'number' ? err.code : -1,
      stdout: err.stdout ?? '',
      stderr: err.stderr ?? String(err.message ?? err),
    };
  }
}

// ---------------------------------------------------------------------------
// Master update  (squad-gameupdate-master.service)
// ---------------------------------------------------------------------------

/**
 * Starts the squad-gameupdate-master.service oneshot (SteamCMD) and blocks
 * until it exits.
 *
 * The matching sudoers line is:
 *   discord ALL=(root) NOPASSWD: /bin/systemctl start --wait squad-gameupdate-master.service
 */
export async function startMasterUpdate() {
  const service = 'squad-gameupdate-master.service';

  try {
    const { stdout, stderr } = await execFileAsync(
      '/usr/bin/sudo',
      ['-n', '/bin/systemctl', 'start', '--wait', service],
      { timeout: UPDATE_TIMEOUT_MS, maxBuffer: MAX_BUFFER },
    );
    return { ok: true, code: 0, stdout, stderr };
  } catch (err) {
    return {
      ok: false,
      code: typeof err.code === 'number' ? err.code : -1,
      stdout: err.stdout ?? '',
      stderr: err.stderr ?? String(err.message ?? err),
    };
  }
}

// ---------------------------------------------------------------------------
// Log streaming  (journalctl -f)
// ---------------------------------------------------------------------------

/**
 * Spawns journalctl following the given service unit.
 * The caller is responsible for calling proc.kill() when done.
 *
 * fullServiceName must be one of:
 *   squad-gameupdate@<instance>.service
 *   squad-gameupdate-master.service
 *
 * Matching sudoers lines use the exact argv:
 *   /bin/journalctl -u <fullServiceName> -f -n 0 -o cat
 */
export function spawnLogFollow(fullServiceName) {
  return spawn('/usr/bin/sudo', [
    '-n',
    '/bin/journalctl',
    '-u', fullServiceName,
    '-f',
    '-n', '0',
    '-o', 'cat',
  ]);
}

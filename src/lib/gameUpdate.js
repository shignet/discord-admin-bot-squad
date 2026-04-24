import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

// Hard-coded script path — matches the exact path granted in the sudoers file.
// No arguments are accepted or forwarded; sudoers whitelists this exact argv.
export const GAME_UPDATE_SCRIPT = '/opt/squad/Skripte/GameUpdate.sh';

const MAX_OUTPUT_BYTES = 256 * 1024;
// SteamCMD downloads can be slow on constrained links; 20 min is a safe upper bound
// that still prevents a runaway process from hanging the bot indefinitely.
const DEFAULT_TIMEOUT_MS = 20 * 60 * 1000;

export async function runGameUpdate() {
  try {
    const { stdout, stderr } = await execFileAsync(
      '/usr/bin/sudo',
      ['-n', GAME_UPDATE_SCRIPT],
      { timeout: DEFAULT_TIMEOUT_MS, maxBuffer: MAX_OUTPUT_BYTES },
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

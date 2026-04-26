import { spawn } from 'node:child_process';

// The bot triggers this systemd unit instead of executing GameUpdate.sh directly.
// The unit runs outside the bot's hardened sandbox so SteamCMD's personality()
// syscall and tee writes to /opt/squad/Log are not blocked. See
// systemd/squad-gameupdate.service and systemd/sudoers.d-discord-admin-bot-squad.
export const GAME_UPDATE_UNIT = 'squad-gameupdate.service';

const MAX_OUTPUT_BYTES = 256 * 1024;
// SteamCMD downloads can be slow on constrained links; 20 min is a safe upper bound
// that still prevents a runaway process from hanging the bot indefinitely. Must be
// less than the unit's TimeoutStartSec.
const DEFAULT_TIMEOUT_MS = 20 * 60 * 1000;
// Grace period after systemctl returns so the journal follower can flush trailing
// lines (the unit's last log lines may arrive a moment after deactivation).
const JOURNAL_FLUSH_MS = 500;

export async function runGameUpdate({ onProgress } = {}) {
  let stdout = '';
  let stderr = '';
  let truncated = false;
  let timedOut = false;

  const append = (target, text) => {
    if (!text) return;
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

  // Start the journal follower BEFORE triggering the unit so we don't miss the
  // first log lines. `-n 0` means: don't replay history, only stream new entries.
  const journal = spawn(
    '/usr/bin/sudo',
    ['-n', '/bin/journalctl', '-u', GAME_UPDATE_UNIT, '-f', '-n', '0', '-o', 'cat'],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  journal.stdout.on('data', (c) => append('stdout', c.toString('utf8')));
  journal.stderr.on('data', (c) => append('stderr', c.toString('utf8')));
  journal.on('error', () => {
    // A journal failure is non-fatal — the run still succeeds or fails on its own.
  });

  // Trigger the unit and wait for it to finish.
  const startResult = await new Promise((resolve) => {
    const child = spawn(
      '/usr/bin/sudo',
      ['-n', '/bin/systemctl', 'start', '--wait', GAME_UPDATE_UNIT],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );

    let sysctlOut = '';
    let sysctlErr = '';
    child.stdout.on('data', (c) => { sysctlOut += c.toString('utf8'); });
    child.stderr.on('data', (c) => { sysctlErr += c.toString('utf8'); });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, DEFAULT_TIMEOUT_MS);

    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ code: -1, sysctlErr: String(err.message ?? err), sysctlOut });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code: typeof code === 'number' ? code : -1, sysctlErr, sysctlOut });
    });
  });

  // Give the journal follower a moment to flush trailing lines, then stop it.
  await new Promise((r) => setTimeout(r, JOURNAL_FLUSH_MS));
  journal.kill('SIGTERM');

  // Surface systemctl's own complaints (e.g. unit failed) to the user.
  if (startResult.sysctlErr) append('stderr', startResult.sysctlErr);

  // Authoritative pass/fail comes from the unit's own properties — `systemctl
  // start --wait` exit code semantics vary across versions when a unit fails.
  const { mainStatus, result: unitResult } = await getUnitFinalState();

  const ok = !timedOut && unitResult === 'success' && mainStatus === 0;

  return {
    ok,
    code: mainStatus,
    stdout,
    stderr: timedOut
      ? `${stderr}\n[killed after ${DEFAULT_TIMEOUT_MS / 1000}s timeout]`
      : stderr,
    truncated,
    timedOut,
  };
}

async function getUnitFinalState() {
  const showProp = (prop) => new Promise((resolve) => {
    const c = spawn(
      '/usr/bin/sudo',
      ['-n', '/bin/systemctl', 'show', '-p', prop, '--value', GAME_UPDATE_UNIT],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let out = '';
    c.stdout.on('data', (d) => { out += d.toString('utf8'); });
    c.on('close', () => resolve(out.trim()));
    c.on('error', () => resolve(''));
  });
  const [mainStatusStr, result] = await Promise.all([
    showProp('ExecMainStatus'),
    showProp('Result'),
  ]);
  const mainStatus = Number.parseInt(mainStatusStr, 10);
  return {
    mainStatus: Number.isFinite(mainStatus) ? mainStatus : -1,
    result: result || 'unknown',
  };
}

import { EmbedBuilder } from 'discord.js';

// Color palette keyed by systemd active-state. Hex ints (Discord embed format).
const STATE_COLOR = Object.freeze({
  active: 0x2ecc71,        // green
  reloading: 0xf1c40f,     // yellow
  activating: 0xf1c40f,    // yellow
  deactivating: 0xe67e22,  // orange
  inactive: 0x95a5a6,      // grey
  failed: 0xe74c3c,        // red
  unknown: 0x7289da,       // blurple fallback
});

const STATE_EMOJI = Object.freeze({
  active: '🟢',
  reloading: '🟡',
  activating: '🟡',
  deactivating: '🟠',
  inactive: '⚪',
  failed: '🔴',
  unknown: '❔',
});

const STATE_LABEL = Object.freeze({
  active: 'Running',
  reloading: 'Reloading',
  activating: 'Starting',
  deactivating: 'Stopping',
  inactive: 'Stopped',
  failed: 'Failed',
  unknown: 'Unknown',
});

/**
 * Parses textual `systemctl status <unit>` output into a structured object.
 * Unknown / missing fields are returned as null. Never throws.
 */
export function parseSystemctlStatus(text) {
  const out = {
    unit: null,
    description: null,
    loadState: null,       // loaded | not-found | masked | …
    enabled: null,         // enabled | disabled | static | …
    activeState: 'unknown',
    subState: null,        // running | dead | exited | failed | …
    since: null,           // raw "since …" timestamp string
    uptime: null,          // human "1h 2min ago" string
    mainPid: null,
    mainProc: null,
    tasks: null,
    memory: null,
    cpu: null,
  };
  if (typeof text !== 'string' || text.trim() === '') return out;

  // Header: "● unit.service - Description" (the bullet may also be ×, ○, etc.)
  const header = text.match(/^[\s]*[●○×⚠✓✱\*]?\s*([A-Za-z0-9@._-]+\.(?:service|target|socket|timer))(?:\s*-\s*(.+))?$/m);
  if (header) {
    out.unit = header[1];
    if (header[2]) out.description = header[2].trim();
  }

  const loaded = text.match(/^\s*Loaded:\s*([a-z-]+)(?:\s*\(([^)]*)\))?/m);
  if (loaded) {
    out.loadState = loaded[1];
    if (loaded[2]) {
      const enabled = loaded[2].split(';').map((s) => s.trim())[1];
      if (enabled) out.enabled = enabled;
    }
  }

  // Active line examples:
  //   Active: active (running) since Mon 2026-04-29 12:34:56 UTC; 1h 2min ago
  //   Active: failed (Result: exit-code) since …; 5min ago
  //   Active: inactive (dead)
  const active = text.match(/^\s*Active:\s*([a-z]+)(?:\s*\(([^)]*)\))?(?:\s*since\s+([^;]+?))?(?:;\s*(.+?))?\s*$/m);
  if (active) {
    out.activeState = active[1];
    if (active[2]) out.subState = active[2].trim();
    if (active[3]) out.since = active[3].trim();
    if (active[4]) out.uptime = active[4].trim();
  }

  const mainPid = text.match(/^\s*Main PID:\s*(\d+)(?:\s*\(([^)]+)\))?/m);
  if (mainPid) {
    out.mainPid = Number(mainPid[1]);
    if (mainPid[2]) out.mainProc = mainPid[2];
  }

  const tasks = text.match(/^\s*Tasks:\s*(\d+)(?:\s*\(limit:\s*(\d+)\))?/m);
  if (tasks) {
    out.tasks = tasks[2] ? `${tasks[1]} / ${tasks[2]}` : tasks[1];
  }

  const memory = text.match(/^\s*Memory:\s*([^\n]+?)\s*$/m);
  if (memory) out.memory = memory[1];

  const cpu = text.match(/^\s*CPU:\s*([^\n]+?)\s*$/m);
  if (cpu) out.cpu = cpu[1];

  return out;
}

/**
 * Returns the trailing N lines of journal/log output that appear after the
 * header section in `systemctl status`. Useful for showing a tiny tail.
 */
export function extractLogTail(text, maxLines = 6) {
  if (typeof text !== 'string') return '';
  const lines = text.split(/\r?\n/);
  // Find the index of the last metadata line we recognise; everything after is log.
  let cut = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*(Loaded|Active|Main PID|Tasks|Memory|CPU|CGroup|TriggeredBy|Triggers|Process|Status|IP|IO|Drop-In|Docs):/.test(lines[i])) {
      cut = i;
    }
    // CGroup block is followed by indented PID lines — keep skipping those.
    if (cut === i && /^\s*CGroup:/.test(lines[i])) {
      let j = i + 1;
      while (j < lines.length && /^\s+[└├│─]/.test(lines[j])) {
        cut = j;
        j++;
      }
    }
  }
  if (cut < 0) return '';
  const tail = lines.slice(cut + 1).filter((l) => l.trim() !== '');
  return tail.slice(-maxLines).join('\n');
}

function colorFor(state) {
  return STATE_COLOR[state] ?? STATE_COLOR.unknown;
}

function emojiFor(state) {
  return STATE_EMOJI[state] ?? STATE_EMOJI.unknown;
}

function labelFor(state) {
  return STATE_LABEL[state] ?? STATE_LABEL.unknown;
}

/**
 * Builds a Discord embed for a `<command> status` reply.
 * `commandLabel` is the short label shown above the unit name (e.g. "Squad server", "Service").
 */
export function buildStatusEmbed({ commandLabel, instance, raw }) {
  const parsed = parseSystemctlStatus(raw);
  const state = parsed.activeState || 'unknown';
  const emoji = emojiFor(state);
  const stateText = parsed.subState
    ? `${labelFor(state)} (${parsed.subState})`
    : labelFor(state);

  const embed = new EmbedBuilder()
    .setColor(colorFor(state))
    .setTitle(`${emoji} ${instance}`)
    .setDescription(`**${stateText}**${parsed.description ? ` — ${parsed.description}` : ''}`)
    .setTimestamp(new Date());

  if (commandLabel) embed.setAuthor({ name: commandLabel });

  const fields = [];
  if (parsed.uptime) fields.push({ name: 'Uptime', value: parsed.uptime, inline: true });
  if (parsed.mainPid) {
    fields.push({
      name: 'Main PID',
      value: parsed.mainProc ? `${parsed.mainPid} (${parsed.mainProc})` : String(parsed.mainPid),
      inline: true,
    });
  }
  if (parsed.memory) fields.push({ name: 'Memory', value: parsed.memory, inline: true });
  if (parsed.cpu) fields.push({ name: 'CPU', value: parsed.cpu, inline: true });
  if (parsed.tasks) fields.push({ name: 'Tasks', value: parsed.tasks, inline: true });
  if (parsed.loadState) {
    const loaded = parsed.enabled ? `${parsed.loadState} · ${parsed.enabled}` : parsed.loadState;
    fields.push({ name: 'Loaded', value: loaded, inline: true });
  }
  if (fields.length > 0) embed.addFields(fields);

  if (parsed.since) embed.setFooter({ text: `since ${parsed.since}` });

  const tail = extractLogTail(raw, 5);
  if (tail) {
    const trimmed = tail.length > 1000 ? `${tail.slice(0, 997)}...` : tail;
    embed.addFields({ name: 'Recent log', value: '```\n' + trimmed + '\n```' });
  }

  return embed;
}

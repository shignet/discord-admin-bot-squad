import { SlashCommandBuilder, MessageFlags, PermissionFlagsBits } from 'discord.js';
import { runGameUpdate, GAME_UPDATE_SCRIPT } from '../lib/gameUpdate.js';
import { postAudit } from '../lib/audit.js';
import { ROLE } from '../lib/permissions.js';

export const data = new SlashCommandBuilder()
  .setName('gameupdate')
  .setDescription('Run the Squad GameUpdate.sh script. Server must be restarted manually afterwards.')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .setDMPermission(false);

export const requiredRoles = [ROLE.SENIOR_ADMIN];

// Discord allows ~5 message edits per 5s; keep a comfortable margin.
const PROGRESS_INTERVAL_MS = 3000;
const PROGRESS_TAIL_LINES = 12;
const PROGRESS_TAIL_CHARS = 1500;

export async function execute(interaction, { logger }) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  logger.info({ script: GAME_UPDATE_SCRIPT }, 'Starting GameUpdate');
  const startedAt = Date.now();

  let latestStdout = '';
  let latestStderr = '';
  let dirty = true;
  let editing = false;
  let lastRendered = '';

  const renderProgress = () => {
    const elapsed = Math.floor((Date.now() - startedAt) / 1000);
    const tail = tailOutput([latestStdout, latestStderr].filter(Boolean).join('\n'));
    const body = tail ? `\n\`\`\`\n${tail}\n\`\`\`` : '';
    return `⏳ Running \`GameUpdate.sh\` (${elapsed}s elapsed)...${body}`;
  };

  const flushProgress = async () => {
    if (!dirty || editing) return;
    dirty = false;
    editing = true;
    try {
      const content = renderProgress();
      if (content !== lastRendered) {
        lastRendered = content;
        await interaction.editReply({ content });
      }
    } catch (err) {
      logger.warn({ err: err?.message }, 'progress edit failed');
    } finally {
      editing = false;
    }
  };

  await flushProgress();
  const ticker = setInterval(flushProgress, PROGRESS_INTERVAL_MS);

  let result;
  try {
    result = await runGameUpdate({
      onProgress: ({ stdout, stderr }) => {
        latestStdout = stdout;
        latestStderr = stderr;
        dirty = true;
      },
    });
  } finally {
    clearInterval(ticker);
  }

  const combinedOutput = truncate(
    [result.stdout, result.stderr].filter(Boolean).join('\n').trim(),
    1800,
  );

  logger.info({ ok: result.ok, code: result.code, timedOut: result.timedOut }, 'GameUpdate finished');

  await interaction.editReply({
    content: formatResult(result, combinedOutput, Date.now() - startedAt),
  });

  await postAudit(interaction.client, {
    user: interaction.user,
    action: '/gameupdate',
    details: combinedOutput || `exit=${result.code}`,
    outcome: result.ok ? 'success' : 'failure',
  });
}

function tailOutput(text) {
  if (!text) return '';
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  const tail = lines.slice(-PROGRESS_TAIL_LINES).join('\n');
  return tail.length > PROGRESS_TAIL_CHARS ? `...${tail.slice(-(PROGRESS_TAIL_CHARS - 3))}` : tail;
}

function formatResult(result, output, elapsedMs) {
  const elapsed = `${Math.round(elapsedMs / 1000)}s`;
  const header = result.ok
    ? `✅ GameUpdate completed in ${elapsed}. Remember to restart the affected Squad instance(s) manually.`
    : result.timedOut
      ? `❌ GameUpdate timed out after ${elapsed}.`
      : `❌ GameUpdate failed in ${elapsed} (exit ${result.code}).`;
  if (!output) return header;
  return `${header}\n\`\`\`\n${output}\n\`\`\``;
}

function truncate(text, max) {
  if (!text) return '';
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

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

export async function execute(interaction, { logger }) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  logger.info({ script: GAME_UPDATE_SCRIPT }, 'Starting GameUpdate');
  const result = await runGameUpdate();
  const combinedOutput = truncate([result.stdout, result.stderr].filter(Boolean).join('\n').trim(), 1800);

  logger.info({ ok: result.ok, code: result.code }, 'GameUpdate finished');

  await interaction.editReply({
    content: formatResult(result, combinedOutput),
  });

  await postAudit(interaction.client, {
    user: interaction.user,
    action: '/gameupdate',
    details: combinedOutput || `exit=${result.code}`,
    outcome: result.ok ? 'success' : 'failure',
  });
}

function formatResult(result, output) {
  const header = result.ok
    ? '\u2705 GameUpdate completed. Remember to restart the affected Squad instance(s) manually.'
    : `\u274c GameUpdate failed (exit ${result.code}).`;
  if (!output) return header;
  return `${header}\n\`\`\`\n${output}\n\`\`\``;
}

function truncate(text, max) {
  if (!text) return '';
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

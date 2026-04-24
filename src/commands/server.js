import { SlashCommandBuilder, MessageFlags, PermissionFlagsBits } from 'discord.js';
import { runSystemctl } from '../lib/systemctl.js';
import { postAudit } from '../lib/audit.js';
import { ROLE } from '../lib/permissions.js';
import { config } from '../config.js';

// Discord string-option choices are limited to 25 entries. We expect far fewer Squad instances
// than that, but guard anyway: if more services are configured, fall back to free-text input and
// rely on the backend allowlist to enforce access.
const MAX_CHOICES = 25;
const serviceChoices = config.squadServices.slice(0, MAX_CHOICES).map((s) => ({ name: s, value: s }));
const useChoices = config.squadServices.length <= MAX_CHOICES;

function addInstanceOption(sub) {
  const opt = sub
    .addStringOption((o) => {
      o.setName('instance').setDescription('Squad server instance to target.').setRequired(true);
      if (useChoices) o.addChoices(...serviceChoices);
      return o;
    });
  return opt;
}

export const data = new SlashCommandBuilder()
  .setName('server')
  .setDescription('Control a Squad server systemd service.')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .setDMPermission(false)
  .addSubcommand((s) => addInstanceOption(s.setName('start').setDescription('Start a Squad server instance.')))
  .addSubcommand((s) => addInstanceOption(s.setName('stop').setDescription('Stop a Squad server instance.')))
  .addSubcommand((s) => addInstanceOption(s.setName('restart').setDescription('Restart a Squad server instance.')))
  .addSubcommand((s) => addInstanceOption(s.setName('status').setDescription('Show a Squad server instance status.')));

// Per-subcommand role matrix: start/stop/restart = senior only, status = senior + admin.
const SUBCOMMAND_ROLES = Object.freeze({
  start: [ROLE.SENIOR_ADMIN],
  stop: [ROLE.SENIOR_ADMIN],
  restart: [ROLE.SENIOR_ADMIN],
  status: [ROLE.SENIOR_ADMIN, ROLE.ADMIN],
});

// This command enforces per-subcommand role rules itself, so no global requiredRoles here.
export const requiredRoles = [];

export async function execute(interaction, { logger }) {
  const sub = interaction.options.getSubcommand();
  const allowed = SUBCOMMAND_ROLES[sub] ?? [];
  const memberRoles = interaction.member.roles.cache;
  const hasRole = allowed.some((roleId) => memberRoles.has(roleId));
  if (!hasRole) {
    logger.warn({ subcommand: sub }, 'Permission denied for /server subcommand');
    await interaction.reply({
      content: 'You do not have the required role for this subcommand.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const instance = interaction.options.getString('instance', true);

  // Backend allowlist — Discord choices are a UI hint, never trusted.
  if (!config.squadServices.includes(instance)) {
    logger.warn({ instance }, 'Rejected unknown instance');
    await interaction.reply({
      content: `Instance \`${instance}\` is not in the configured allowlist.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const result = await runSystemctl(sub, instance);
  const combinedOutput = truncate([result.stdout, result.stderr].filter(Boolean).join('\n').trim(), 1800);

  logger.info({ subcommand: sub, instance, ok: result.ok, code: result.code }, 'systemctl executed');

  await interaction.editReply({
    content: formatResult(sub, instance, result, combinedOutput),
  });

  await postAudit(interaction.client, {
    user: interaction.user,
    action: `/server ${sub} \u2014 ${instance}`,
    details: combinedOutput || `exit=${result.code}`,
    outcome: result.ok ? 'success' : 'failure',
  });
}

function formatResult(sub, instance, result, output) {
  const header = result.ok
    ? `\u2705 \`${sub}\` executed on ${instance}`
    : `\u274c \`${sub}\` failed on ${instance} (exit ${result.code})`;
  if (!output) return header;
  return `${header}\n\`\`\`\n${output}\n\`\`\``;
}

function truncate(text, max) {
  if (!text) return '';
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

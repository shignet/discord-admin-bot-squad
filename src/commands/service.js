import {
  SlashCommandBuilder,
  MessageFlags,
  PermissionFlagsBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
} from 'discord.js';
import { runSystemctl } from '../lib/systemctl.js';
import { postAudit } from '../lib/audit.js';
import { ROLE } from '../lib/permissions.js';
import { config } from '../config.js';

const CONFIRM_TIMEOUT_MS = 15_000;
const DESTRUCTIVE_SUBCOMMANDS = new Set(['stop', 'restart']);

// Discord string-option choices are limited to 25 entries. Same fallback shape as /server.
const MAX_CHOICES = 25;
const serviceChoices = config.auxServices.slice(0, MAX_CHOICES).map((s) => ({ name: s, value: s }));
const useChoices = config.auxServices.length > 0 && config.auxServices.length <= MAX_CHOICES;

function addServiceOption(sub) {
  return sub.addStringOption((o) => {
    o.setName('service').setDescription('Auxiliary systemd service to target.').setRequired(true);
    if (useChoices) o.addChoices(...serviceChoices);
    return o;
  });
}

export const data = new SlashCommandBuilder()
  .setName('service')
  .setDescription('Control an auxiliary systemd service (SquadJS, whitelister, …).')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .setDMPermission(false)
  .addSubcommand((s) => addServiceOption(s.setName('start').setDescription('Start an auxiliary service.')))
  .addSubcommand((s) => addServiceOption(s.setName('stop').setDescription('Stop an auxiliary service.')))
  .addSubcommand((s) => addServiceOption(s.setName('restart').setDescription('Restart an auxiliary service.')))
  .addSubcommand((s) => addServiceOption(s.setName('status').setDescription('Show an auxiliary service status.')));

// Same role matrix as /server: senior=control, senior+admin=status.
const SUBCOMMAND_ROLES = Object.freeze({
  start: [ROLE.SENIOR_ADMIN],
  stop: [ROLE.SENIOR_ADMIN],
  restart: [ROLE.SENIOR_ADMIN],
  status: [ROLE.SENIOR_ADMIN, ROLE.ADMIN],
});

export const requiredRoles = [];

export async function execute(interaction, { logger }) {
  const sub = interaction.options.getSubcommand();
  const allowed = (SUBCOMMAND_ROLES[sub] ?? []).flat();
  const memberRoles = interaction.member.roles.cache;
  const hasRole = allowed.some((roleId) => memberRoles.has(roleId));
  if (!hasRole) {
    logger.warn({ subcommand: sub }, 'Permission denied for /service subcommand');
    await interaction.reply({
      content: 'You do not have the required role for this subcommand.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (config.auxServices.length === 0) {
    await interaction.reply({
      content: 'No auxiliary services are configured (`AUX_SERVICES` is empty).',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const service = interaction.options.getString('service', true);

  // Backend allowlist — Discord choices are a UI hint, never trusted.
  if (!config.auxServices.includes(service)) {
    logger.warn({ service }, 'Rejected unknown auxiliary service');
    await interaction.reply({
      content: `Service \`${service}\` is not in the configured allowlist.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  if (DESTRUCTIVE_SUBCOMMANDS.has(sub)) {
    const confirmed = await confirmDestructive(interaction, sub, service, logger);
    if (!confirmed) return;
  }

  const result = await runSystemctl(sub, service, config.auxServices);
  const combinedOutput = truncate([result.stdout, result.stderr].filter(Boolean).join('\n').trim(), 1800);

  logger.info({ subcommand: sub, service, ok: result.ok, code: result.code }, 'systemctl executed (aux)');

  await interaction.editReply({
    content: formatResult(sub, service, result, combinedOutput),
  });

  await postAudit(interaction.client, {
    user: interaction.user,
    action: `/service ${sub} — ${service}`,
    details: combinedOutput || `exit=${result.code}`,
    outcome: result.ok ? 'success' : 'failure',
  });
}

async function confirmDestructive(interaction, sub, service, logger) {
  const confirmId = `service:${sub}:${service}:confirm:${interaction.id}`;
  const cancelId = `service:${sub}:${service}:cancel:${interaction.id}`;

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(confirmId).setLabel(`Yes, ${sub}`).setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(cancelId).setLabel('Cancel').setStyle(ButtonStyle.Secondary),
  );

  const message = await interaction.editReply({
    content:
      `⚠️ You are about to **${sub}** \`${service}\`. ` +
      `Confirm within ${CONFIRM_TIMEOUT_MS / 1000}s.`,
    components: [row],
  });

  try {
    const button = await message.awaitMessageComponent({
      componentType: ComponentType.Button,
      filter: (i) => i.user.id === interaction.user.id && (i.customId === confirmId || i.customId === cancelId),
      time: CONFIRM_TIMEOUT_MS,
    });

    if (button.customId === cancelId) {
      logger.info({ subcommand: sub, service }, 'destructive aux action cancelled by user');
      await button.update({ content: `❌ \`${sub}\` on \`${service}\` cancelled.`, components: [] });
      return false;
    }

    await button.update({ content: `⏳ Running \`${sub}\` on \`${service}\`...`, components: [] });
    return true;
  } catch (err) {
    logger.info({ subcommand: sub, service, err: err?.message }, 'destructive aux action confirmation timed out');
    await interaction.editReply({
      content: `⏱️ Confirmation timed out. \`${sub}\` on \`${service}\` not executed.`,
      components: [],
    });
    return false;
  }
}

function formatResult(sub, service, result, output) {
  const header = result.ok
    ? `✅ \`${sub}\` executed on ${service}`
    : `❌ \`${sub}\` failed on ${service} (exit ${result.code})`;
  if (!output) return header;
  return `${header}\n\`\`\`\n${output}\n\`\`\``;
}

function truncate(text, max) {
  if (!text) return '';
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

import {
  SlashCommandBuilder,
  MessageFlags,
  PermissionFlagsBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  EmbedBuilder,
} from 'discord.js';
import { runSystemctl } from '../lib/systemctl.js';
import { respondViaAudit, COLOR } from '../lib/audit.js';
import { ROLE } from '../lib/permissions.js';
import { buildStatusEmbed } from '../lib/statusFormat.js';
import { config } from '../config.js';

const CONFIRM_TIMEOUT_MS = 15_000;
const DESTRUCTIVE_SUBCOMMANDS = new Set(['stop', 'restart']);

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
  const allowed = (SUBCOMMAND_ROLES[sub] ?? []).flat();
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

  if (DESTRUCTIVE_SUBCOMMANDS.has(sub)) {
    const confirmed = await confirmDestructive(interaction, sub, instance, logger);
    if (!confirmed) return;
  }

  const result = await runSystemctl(sub, instance);
  const combinedOutput = truncate([result.stdout, result.stderr].filter(Boolean).join('\n').trim(), 1500);

  logger.info({ subcommand: sub, instance, ok: result.ok, code: result.code }, 'systemctl executed');

  if (sub === 'status') {
    const embed = buildStatusEmbed({
      commandLabel: `/server status`,
      instance,
      raw: [result.stdout, result.stderr].filter(Boolean).join('\n'),
    });
    await respondViaAudit(interaction, embed);
    return;
  }

  const embed = buildActionEmbed({ command: '/server', sub, target: instance, result, output: combinedOutput });
  await respondViaAudit(interaction, embed);
}

async function confirmDestructive(interaction, sub, instance, logger) {
  const confirmId = `server:${sub}:${instance}:confirm:${interaction.id}`;
  const cancelId = `server:${sub}:${instance}:cancel:${interaction.id}`;

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(confirmId).setLabel(`Yes, ${sub}`).setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(cancelId).setLabel('Cancel').setStyle(ButtonStyle.Secondary),
  );

  const message = await interaction.editReply({
    content:
      `⚠️ You are about to **${sub}** \`${instance}\`. ` +
      `This will interrupt the running server. Confirm within ${CONFIRM_TIMEOUT_MS / 1000}s.`,
    components: [row],
  });

  try {
    const button = await message.awaitMessageComponent({
      componentType: ComponentType.Button,
      filter: (i) => i.user.id === interaction.user.id && (i.customId === confirmId || i.customId === cancelId),
      time: CONFIRM_TIMEOUT_MS,
    });

    if (button.customId === cancelId) {
      logger.info({ subcommand: sub, instance }, 'destructive action cancelled by user');
      await button.update({ content: `❌ \`${sub}\` on \`${instance}\` cancelled.`, components: [] });
      return false;
    }

    await button.update({ content: `⏳ Running \`${sub}\` on \`${instance}\`...`, components: [] });
    return true;
  } catch (err) {
    logger.info({ subcommand: sub, instance, err: err?.message }, 'destructive action confirmation timed out');
    await interaction.editReply({
      content: `⏱️ Confirmation timed out. \`${sub}\` on \`${instance}\` not executed.`,
      components: [],
    });
    return false;
  }
}

function buildActionEmbed({ command, sub, target, result, output }) {
  const ok = result.ok;
  const emoji = ok ? '✅' : '❌';
  const embed = new EmbedBuilder()
    .setColor(ok ? COLOR.success : COLOR.failure)
    .setTitle(`${emoji} ${command} ${sub} — ${target}`)
    .setDescription(ok ? `\`${sub}\` executed successfully.` : `\`${sub}\` failed (exit ${result.code}).`);
  if (output) {
    embed.addFields({ name: 'Output', value: '```\n' + output + '\n```' });
  }
  return embed;
}

function truncate(text, max) {
  if (!text) return '';
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

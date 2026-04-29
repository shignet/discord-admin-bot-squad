import { SlashCommandBuilder, MessageFlags, PermissionFlagsBits, EmbedBuilder } from 'discord.js';
import {
  classifyPlayerId,
  sanitizeAdminName,
  INVALID_PLAYER_ID_MESSAGE,
  INVALID_ADMIN_NAME_MESSAGE,
} from '../lib/validation.js';
import { addTrainAdmin, removeTrainAdmin, listTrainAdmin, TRAIN_ADMINS_GROUP } from '../lib/adminsCfg.js';
import { respondViaAudit, COLOR } from '../lib/audit.js';
import { ROLE } from '../lib/permissions.js';
import { config } from '../config.js';

export const data = new SlashCommandBuilder()
  .setName('patreonadmin')
  .setDescription('Manage members of the TrainAdmin group in Admins.cfg.')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .setDMPermission(false)
  .addSubcommand((s) =>
    s
      .setName('add')
      .setDescription('Add a SteamID64 or EOS ID to the TrainAdmin group.')
      .addStringOption((o) =>
        o.setName('id').setDescription('SteamID64 (17 digits) or EOS ID (32 lowercase hex).').setRequired(true),
      )
      .addStringOption((o) =>
        o
          .setName('name')
          .setDescription('Player name for the trailing `// name` comment (1–32 chars).')
          .setRequired(true)
          .setMaxLength(32),
      ),
  )
  .addSubcommand((s) =>
    s
      .setName('remove')
      .setDescription('Remove a SteamID64 or EOS ID from the TrainAdmin group.')
      .addStringOption((o) =>
        o.setName('id').setDescription('SteamID64 (17 digits) or EOS ID (32 lowercase hex).').setRequired(true),
      ),
  )
  .addSubcommand((s) => s.setName('list').setDescription('List all TrainAdmin entries.'));

// Senior and regular admins may both manage TrainAdmin.
export const requiredRoles = [ROLE.SENIOR_ADMIN, ROLE.ADMIN];

const RESTART_NOTE = `A restart of the \`${config.squadService}\` instance is required for the change to take effect.`;

export async function execute(interaction, { logger }) {
  const sub = interaction.options.getSubcommand();
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  if (sub === 'list') {
    return handleList(interaction, logger);
  }

  const rawId = interaction.options.getString('id', true);
  const classification = classifyPlayerId(rawId);
  if (!classification) {
    logger.info({ sub }, 'Rejected invalid id');
    await interaction.editReply({ content: INVALID_PLAYER_ID_MESSAGE });
    return;
  }

  if (sub === 'add') {
    const rawName = interaction.options.getString('name', true);
    const name = sanitizeAdminName(rawName);
    if (!name) {
      logger.info({ sub }, 'Rejected invalid name');
      await interaction.editReply({ content: INVALID_ADMIN_NAME_MESSAGE });
      return;
    }
    return handleAdd(interaction, logger, classification, name);
  }
  if (sub === 'remove') return handleRemove(interaction, logger, classification);
}

async function handleAdd(interaction, logger, { type, value }, name) {
  const result = await addTrainAdmin(config.paths.adminsCfg, value, name);

  if (!result.changed) {
    logger.info({ id: value, type, reason: result.reason }, 'trainadmin add: no change');
    const embed = new EmbedBuilder()
      .setColor(COLOR.info)
      .setTitle(`ℹ️ /patreonadmin add — ${value}`)
      .setDescription(`ID \`${value}\` (${type}) is already a TrainAdmin. No change.`);
    await respondViaAudit(interaction, embed);
    return;
  }

  logger.info({ id: value, type, name, backupPath: result.backupPath }, 'trainadmin added');
  const embed = new EmbedBuilder()
    .setColor(COLOR.success)
    .setTitle(`✅ /patreonadmin add — ${name}`)
    .setDescription(`Added \`${value}\` (${type}) as \`${name}\` to group \`${TRAIN_ADMINS_GROUP}\`.`)
    .addFields(
      { name: 'Backup', value: '`' + result.backupPath + '`' },
      { name: '⚠️ Action required', value: RESTART_NOTE },
    );
  await respondViaAudit(interaction, embed);
}

async function handleRemove(interaction, logger, { type, value }) {
  const result = await removeTrainAdmin(config.paths.adminsCfg, value);

  if (!result.changed) {
    logger.info({ id: value, type, reason: result.reason }, 'trainadmin remove: no change');
    const embed = new EmbedBuilder()
      .setColor(COLOR.info)
      .setTitle(`ℹ️ /patreonadmin remove — ${value}`)
      .setDescription(`ID \`${value}\` (${type}) is not a TrainAdmin. No change.`);
    await respondViaAudit(interaction, embed);
    return;
  }

  logger.info(
    { id: value, type, removedCount: result.removedCount, backupPath: result.backupPath },
    'trainadmin removed',
  );
  const lineWord = result.removedCount === 1 ? 'line' : 'lines';
  const embed = new EmbedBuilder()
    .setColor(COLOR.success)
    .setTitle(`✅ /patreonadmin remove — ${value}`)
    .setDescription(`Removed \`${value}\` (${type}) from group \`${TRAIN_ADMINS_GROUP}\` (${result.removedCount} ${lineWord}).`)
    .addFields(
      { name: 'Backup', value: '`' + result.backupPath + '`' },
      { name: '⚠️ Action required', value: RESTART_NOTE },
    );
  await respondViaAudit(interaction, embed);
}

async function handleList(interaction, logger) {
  const entries = await listTrainAdmin(config.paths.adminsCfg);
  logger.info({ count: entries.length }, 'trainadmin list');

  const embed = new EmbedBuilder()
    .setColor(COLOR.info)
    .setTitle(`📜 ${TRAIN_ADMINS_GROUP} (${entries.length})`);

  if (entries.length === 0) {
    embed.setDescription('_(no entries)_');
  } else {
    const body = entries.map((e, i) => `${i + 1}. \`${e.id}\` (${e.idType})`).join('\n');
    const MAX = 3800;
    embed.setDescription(body.length > MAX ? `${body.slice(0, MAX - 3)}...` : body);
  }
  await respondViaAudit(interaction, embed);
}

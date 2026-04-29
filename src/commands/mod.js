import { SlashCommandBuilder, MessageFlags, PermissionFlagsBits, EmbedBuilder } from 'discord.js';
import { isValidModId, INVALID_MOD_ID_MESSAGE } from '../lib/validation.js';
import { addMod, removeMod, listMods } from '../lib/configSh.js';
import { respondViaAudit, COLOR } from '../lib/audit.js';
import { ROLE } from '../lib/permissions.js';
import { config } from '../config.js';

export const data = new SlashCommandBuilder()
  .setName('mod')
  .setDescription('Manage the DSG_MOD_LIST entry in config.sh.')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .setDMPermission(false)
  .addSubcommand((s) =>
    s
      .setName('add')
      .setDescription('Add a Steam Workshop mod ID to DSG_MOD_LIST.')
      .addStringOption((o) =>
        o.setName('modid').setDescription('Steam Workshop ID (digits only).').setRequired(true),
      ),
  )
  .addSubcommand((s) =>
    s
      .setName('remove')
      .setDescription('Remove a Steam Workshop mod ID from DSG_MOD_LIST.')
      .addStringOption((o) =>
        o.setName('modid').setDescription('Steam Workshop ID (digits only).').setRequired(true),
      ),
  )
  .addSubcommand((s) => s.setName('list').setDescription('List the current DSG_MOD_LIST entries.'));

// Senior admins only.
export const requiredRoles = [ROLE.SENIOR_ADMIN];

export async function execute(interaction, { logger }) {
  const sub = interaction.options.getSubcommand();
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  if (sub === 'list') return handleList(interaction, logger);

  const modId = interaction.options.getString('modid', true);
  if (!isValidModId(modId)) {
    logger.info({ sub }, 'Rejected invalid mod id');
    await interaction.editReply({ content: INVALID_MOD_ID_MESSAGE });
    return;
  }

  if (sub === 'add') return handleAdd(interaction, logger, modId);
  if (sub === 'remove') return handleRemove(interaction, logger, modId);
}

const RESTART_NOTE = `A restart of the \`${config.squadService}\` instance is required for the change to take effect.`;

async function handleAdd(interaction, logger, modId) {
  const result = await addMod(config.paths.configSh, modId);

  if (!result.changed) {
    logger.info({ modId, reason: result.reason }, 'mod add: no change');
    const embed = new EmbedBuilder()
      .setColor(COLOR.info)
      .setTitle(`ℹ️ /mod add — ${modId}`)
      .setDescription(`Mod \`${modId}\` is already in \`DSG_MOD_LIST\`. No change.`);
    await respondViaAudit(interaction, embed);
    return;
  }

  logger.info({ modId, count: result.mods.length, backupPath: result.backupPath }, 'mod added');
  const embed = new EmbedBuilder()
    .setColor(COLOR.success)
    .setTitle(`✅ /mod add — ${modId}`)
    .setDescription(`Mod \`${modId}\` added to \`DSG_MOD_LIST\`.`)
    .addFields(
      { name: 'New count', value: String(result.mods.length), inline: true },
      { name: 'Backup', value: '`' + result.backupPath + '`', inline: false },
      { name: '⚠️ Action required', value: RESTART_NOTE },
    );
  await respondViaAudit(interaction, embed);
}

async function handleRemove(interaction, logger, modId) {
  const result = await removeMod(config.paths.configSh, modId);

  if (!result.changed) {
    logger.info({ modId, reason: result.reason }, 'mod remove: no change');
    const embed = new EmbedBuilder()
      .setColor(COLOR.info)
      .setTitle(`ℹ️ /mod remove — ${modId}`)
      .setDescription(`Mod \`${modId}\` is not in \`DSG_MOD_LIST\`. No change.`);
    await respondViaAudit(interaction, embed);
    return;
  }

  logger.info({ modId, count: result.mods.length, backupPath: result.backupPath }, 'mod removed');
  const embed = new EmbedBuilder()
    .setColor(COLOR.success)
    .setTitle(`✅ /mod remove — ${modId}`)
    .setDescription(`Mod \`${modId}\` removed from \`DSG_MOD_LIST\`.`)
    .addFields(
      { name: 'New count', value: String(result.mods.length), inline: true },
      { name: 'Backup', value: '`' + result.backupPath + '`', inline: false },
      { name: '⚠️ Action required', value: RESTART_NOTE },
    );
  await respondViaAudit(interaction, embed);
}

async function handleList(interaction, logger) {
  const mods = await listMods(config.paths.configSh);
  logger.info({ count: mods.length }, 'mod list');

  const embed = new EmbedBuilder()
    .setColor(COLOR.info)
    .setTitle(`📜 DSG_MOD_LIST (${mods.length})`);

  if (mods.length === 0) {
    embed.setDescription('_(empty)_');
  } else {
    const body = mods.map((id, i) => `${i + 1}. \`${id}\``).join('\n');
    const MAX = 3800;
    embed.setDescription(body.length > MAX ? `${body.slice(0, MAX - 3)}...` : body);
  }
  await respondViaAudit(interaction, embed);
}

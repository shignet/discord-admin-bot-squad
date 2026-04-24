import { SlashCommandBuilder, MessageFlags, PermissionFlagsBits } from 'discord.js';
import { isValidModId, INVALID_MOD_ID_MESSAGE } from '../lib/validation.js';
import { addMod, removeMod, listMods } from '../lib/configSh.js';
import { postAudit } from '../lib/audit.js';
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

async function handleAdd(interaction, logger, modId) {
  const result = await addMod(config.paths.configSh, modId);

  if (!result.changed) {
    logger.info({ modId, reason: result.reason }, 'mod add: no change');
    await interaction.editReply({ content: `Mod \`${modId}\` is already in DSG_MOD_LIST. No change.` });
    return;
  }

  logger.info({ modId, count: result.mods.length, backupPath: result.backupPath }, 'mod added');
  await interaction.editReply({
    content:
      `\u2705 Added mod \`${modId}\`. DSG_MOD_LIST now has ${result.mods.length} entries.\n` +
      `\u26a0\ufe0f A restart of the \`${config.squadService}\` instance is required for the change to take effect.`,
  });

  await postAudit(interaction.client, {
    user: interaction.user,
    action: '/mod add',
    details: `modId=${modId}\nnewCount=${result.mods.length}\nbackup=${result.backupPath}`,
    outcome: 'success',
  });
}

async function handleRemove(interaction, logger, modId) {
  const result = await removeMod(config.paths.configSh, modId);

  if (!result.changed) {
    logger.info({ modId, reason: result.reason }, 'mod remove: no change');
    await interaction.editReply({ content: `Mod \`${modId}\` is not in DSG_MOD_LIST. No change.` });
    return;
  }

  logger.info({ modId, count: result.mods.length, backupPath: result.backupPath }, 'mod removed');
  await interaction.editReply({
    content:
      `\u2705 Removed mod \`${modId}\`. DSG_MOD_LIST now has ${result.mods.length} entries.\n` +
      `\u26a0\ufe0f A restart of the \`${config.squadService}\` instance is required for the change to take effect.`,
  });

  await postAudit(interaction.client, {
    user: interaction.user,
    action: '/mod remove',
    details: `modId=${modId}\nnewCount=${result.mods.length}\nbackup=${result.backupPath}`,
    outcome: 'success',
  });
}

async function handleList(interaction, logger) {
  const mods = await listMods(config.paths.configSh);
  logger.info({ count: mods.length }, 'mod list');

  if (mods.length === 0) {
    await interaction.editReply({ content: 'DSG_MOD_LIST is empty.' });
    return;
  }

  const body = mods.map((id, i) => `${i + 1}. \`${id}\``).join('\n');
  const MAX = 1900;
  const content =
    `**DSG_MOD_LIST** (${mods.length}):\n` +
    (body.length > MAX ? `${body.slice(0, MAX - 3)}...` : body);
  await interaction.editReply({ content });
}

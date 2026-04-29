import { EmbedBuilder, MessageFlags } from 'discord.js';
import { config } from '../config.js';

export const COLOR = Object.freeze({
  success: 0x3fb950,
  failure: 0xf85149,
  info: 0x58a6ff,
  warning: 0xf1c40f,
});

export async function postAudit(client, { user, action, details, outcome = 'success' }) {
  const channel = await client.channels.fetch(config.auditChannelId).catch(() => null);
  if (!channel || !channel.isTextBased()) return;

  const embed = new EmbedBuilder()
    .setColor(COLOR[outcome] ?? COLOR.info)
    .setAuthor({ name: `${user.tag} (${user.id})` })
    .setTitle(action)
    .setTimestamp(new Date());

  if (details) {
    const truncated = details.length > 1024 ? `${details.slice(0, 1021)}...` : details;
    embed.setDescription(`\`\`\`\n${truncated}\n\`\`\``);
  }

  await channel.send({ embeds: [embed] }).catch(() => {});
}

// Posts a pre-built embed (e.g. rich status view) to the audit channel.
// The caller is responsible for setting author/title/fields. Returns true on success.
export async function postAuditEmbed(client, embed) {
  const channel = await client.channels.fetch(config.auditChannelId).catch(() => null);
  if (!channel || !channel.isTextBased()) return false;
  await channel.send({ embeds: [embed] }).catch(() => {});
  return true;
}

/**
 * Final-output convention for slash commands: post a rich embed to the audit channel
 * and remove the ephemeral interaction reply. If the audit channel is unavailable,
 * fall back to an ephemeral followUp so the user still sees the result.
 *
 * The embed gets the invoker's tag/id auto-stamped as author and a current timestamp,
 * unless the caller already set them.
 */
export async function respondViaAudit(interaction, embed) {
  const data = embed.data ?? {};
  if (!data.author) embed.setAuthor({ name: `${interaction.user.tag} (${interaction.user.id})` });
  if (!data.timestamp) embed.setTimestamp(new Date());

  const posted = await postAuditEmbed(interaction.client, embed);
  await interaction.deleteReply().catch(() => {});
  if (!posted) {
    await interaction.followUp({
      content: 'Audit channel unavailable; result not delivered.',
      embeds: [embed],
      flags: MessageFlags.Ephemeral,
    }).catch(() => {});
  }
  return posted;
}

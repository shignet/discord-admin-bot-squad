import { EmbedBuilder } from 'discord.js';
import { config } from '../config.js';

const COLOR = Object.freeze({
  success: 0x3fb950,
  failure: 0xf85149,
  info: 0x58a6ff,
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

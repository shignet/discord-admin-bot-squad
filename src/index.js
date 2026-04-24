import { Client, Events, GatewayIntentBits, MessageFlags } from 'discord.js';
import { config } from './config.js';
import { loadCommands } from './commandLoader.js';
import { logger } from './lib/logger.js';
import { hasRequiredRole } from './lib/permissions.js';

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

const commands = await loadCommands();
logger.info({ count: commands.size, names: [...commands.keys()] }, 'Commands loaded');

client.once(Events.ClientReady, (c) => {
  logger.info({ user: c.user.tag }, 'Bot ready');
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const command = commands.get(interaction.commandName);
  if (!command) {
    logger.warn({ name: interaction.commandName }, 'Received unknown command');
    return;
  }

  const childLogger = logger.child({
    command: interaction.commandName,
    subcommand: interaction.options.getSubcommand(false) ?? null,
    userId: interaction.user.id,
    userTag: interaction.user.tag,
    guildId: interaction.guildId,
  });

  if (interaction.guildId !== config.discord.guildId) {
    await interaction.reply({ content: 'This bot is not available in this guild.', flags: MessageFlags.Ephemeral });
    return;
  }

  const requiredRoles = command.requiredRoles ?? [];
  if (requiredRoles.length > 0 && !hasRequiredRole(interaction, requiredRoles)) {
    childLogger.warn('Permission denied');
    await interaction.reply({
      content: 'You do not have the required role to use this command.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  try {
    await command.execute(interaction, { logger: childLogger });
  } catch (err) {
    childLogger.error({ err }, 'Command execution failed');
    const payload = {
      content: 'An internal error occurred while executing the command.',
      flags: MessageFlags.Ephemeral,
    };
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp(payload).catch(() => {});
    } else {
      await interaction.reply(payload).catch(() => {});
    }
  }
});

function shutdown(signal) {
  logger.info({ signal }, 'Shutting down');
  client.destroy().finally(() => process.exit(0));
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

process.on('unhandledRejection', (reason) => {
  logger.error({ err: reason }, 'Unhandled promise rejection');
});

await client.login(config.discord.token);

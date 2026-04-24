import { REST, Routes } from 'discord.js';
import { config } from './config.js';
import { loadCommands } from './commandLoader.js';
import { logger } from './lib/logger.js';

const commands = await loadCommands();
const body = [...commands.values()].map((c) => c.data.toJSON());

const rest = new REST({ version: '10' }).setToken(config.discord.token);

logger.info({ count: body.length }, 'Registering guild commands');
const data = await rest.put(
  Routes.applicationGuildCommands(config.discord.clientId, config.discord.guildId),
  { body },
);
logger.info({ count: data.length }, 'Guild commands registered');

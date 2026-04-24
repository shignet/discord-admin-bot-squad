import pino from 'pino';
import { config } from '../config.js';

export const logger = pino({
  level: config.logLevel,
  base: { app: 'discord-admin-bot-squad' },
  timestamp: pino.stdTimeFunctions.isoTime,
});

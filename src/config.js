import 'dotenv/config';
import path from 'node:path';
import { parseServiceList } from './lib/systemctlGuard.js';
import { parseInstanceList } from './lib/gameUpdateGuard.js'; // [NEW]

const SNOWFLAKE = /^\d{17,20}$/;

function required(name) {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function requireSnowflake(name) {
  const value = required(name);
  if (!SNOWFLAKE.test(value)) {
    throw new Error(`Environment variable ${name} is not a valid Discord snowflake`);
  }
  return value;
}

function requireAbsolutePath(name) {
  const value = required(name);
  if (!path.isAbsolute(value)) {
    throw new Error(`Environment variable ${name} must be an absolute path`);
  }
  return value;
}

function requireServiceList(name) {
  const value = required(name);
  try {
    return parseServiceList(value);
  } catch (err) {
    throw new Error(`Environment variable ${name}: ${err.message}`);
  }
}

// [NEW] Parses SQUAD_INSTANCES (comma-separated instance names, e.g. "public,train,supporter-train")
function requireInstanceList(name) {
  const value = required(name);
  try {
    return parseInstanceList(value);
  } catch (err) {
    throw new Error(`Environment variable ${name}: ${err.message}`);
  }
}

export const config = Object.freeze({
  discord: {
    token: required('DISCORD_TOKEN'),
    clientId: requireSnowflake('DISCORD_CLIENT_ID'),
    guildId: requireSnowflake('DISCORD_GUILD_ID'),
  },
  roles: {
    seniorAdminId: requireSnowflake('SENIOR_ADMIN_ROLE_ID'),
    adminId: requireSnowflake('ADMIN_ROLE_ID'),
  },
  auditChannelId: requireSnowflake('AUDIT_CHANNEL_ID'),
  squadServices: requireServiceList('SQUAD_SERVICES'),
  squadInstances: requireInstanceList('SQUAD_INSTANCES'), // [NEW]
  paths: {
    adminsCfg: requireAbsolutePath('ADMINS_CFG_PATH'),
    configSh: requireAbsolutePath('CONFIG_SH_PATH'),
  },
  logLevel: process.env.LOG_LEVEL ?? 'info',
});

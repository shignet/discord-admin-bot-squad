import { readdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const COMMANDS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'commands');

export async function loadCommands() {
  const entries = await readdir(COMMANDS_DIR, { withFileTypes: true });
  const commands = new Map();

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.js')) continue;

    const filePath = path.join(COMMANDS_DIR, entry.name);
    const module = await import(pathToFileURL(filePath).href);

    if (!module.data || typeof module.execute !== 'function') {
      throw new Error(`Command module ${entry.name} must export \`data\` and \`execute\`.`);
    }

    const name = module.data.name;
    if (commands.has(name)) {
      throw new Error(`Duplicate command name: ${name}`);
    }
    commands.set(name, module);
  }

  return commands;
}

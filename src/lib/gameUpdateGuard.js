// src/lib/gameUpdateGuard.js
// Validation helpers for the /update command — mirrors the pattern of systemctlGuard.js.

const SAFE_INSTANCE = /^[a-z0-9][a-z0-9-]*$/;

/**
 * Parses and validates a comma-separated list of instance names (from SQUAD_INSTANCES env var).
 * Instance names must match /^[a-z0-9][a-z0-9-]*$/ — lowercase letters, digits, hyphens only.
 */
export function parseInstanceList(raw) {
  const items = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  if (items.length === 0) throw new Error('instance list is empty');

  for (const item of items) {
    if (!SAFE_INSTANCE.test(item)) {
      throw new Error(
        `invalid instance name ${JSON.stringify(item)} — only lowercase letters, digits, and hyphens allowed`,
      );
    }
  }

  return items;
}

/**
 * Throws if the instance name is not in the allowed list.
 * Called immediately before constructing any execFile argv.
 */
export function assertAllowedInstance(instance, allowedInstances) {
  if (!SAFE_INSTANCE.test(instance)) {
    throw new Error(`Invalid instance name: ${JSON.stringify(instance)}`);
  }
  if (!allowedInstances.includes(instance)) {
    throw new Error(`Instance not in allowed list: ${JSON.stringify(instance)}`);
  }
}

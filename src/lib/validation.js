// Strict allowlist regexes. No silent normalization — reject malformed input outright.
export const STEAM_ID_64 = /^7656119\d{10}$/;       // 17 digits, Steam community namespace prefix
export const EOS_ID = /^[0-9a-f]{32}$/;             // 32 lowercase hex chars (no uppercase, no silent toLowerCase)
export const MOD_ID = /^\d{1,20}$/;                 // digits only, length capped

export function classifyPlayerId(input) {
  if (typeof input !== 'string') return null;
  if (STEAM_ID_64.test(input)) return { type: 'steam', value: input };
  if (EOS_ID.test(input)) return { type: 'eos', value: input };
  return null;
}

export function isValidModId(input) {
  return typeof input === 'string' && MOD_ID.test(input);
}

export const INVALID_PLAYER_ID_MESSAGE =
  'Invalid ID. Expected a 17-digit SteamID64 or a 32-character lowercase-hex EOS ID.';

export const INVALID_MOD_ID_MESSAGE =
  'Invalid mod ID. Expected a numeric Steam Workshop ID (up to 20 digits).';

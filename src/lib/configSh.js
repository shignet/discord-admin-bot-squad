import { readText, writeAtomicWithBackup } from './atomicFile.js';
import { isValidModId, MOD_ID } from './validation.js';

// Targets lines shaped like:
//   export DSG_MOD_LIST="id1 id2 id3"
//   export DSG_MOD_LIST='id1 id2'
//   export DSG_MOD_LIST=                (empty, unquoted)
//   export DSG_MOD_LIST=id1             (single unquoted token)
// Captures: 1=leading ws, 2=double-quoted inner, 3=single-quoted inner,
// 4=unquoted token, 5=trailing (whitespace and optional comment).
const MOD_LIST_LINE =
  /^(\s*)export\s+DSG_MOD_LIST\s*=\s*(?:"([^"\r\n]*)"|'([^'\r\n]*)'|([^\s#"'\r\n]*))(\s*(?:#.*)?)$/;

function findModListLine(lines) {
  for (let i = 0; i < lines.length; i += 1) {
    const m = lines[i].match(MOD_LIST_LINE);
    if (!m) continue;
    const inner = m[2] ?? m[3] ?? m[4] ?? '';
    return { index: i, leading: m[1], inner, trailing: m[5] ?? '' };
  }
  return null;
}

function renderLine(leading, ids, trailing) {
  return `${leading}export DSG_MOD_LIST="${ids.join(' ')}"${trailing}`;
}

function parseInner(inner) {
  // Space-separated mod IDs. Defensive: also split on any whitespace and drop empties.
  return inner.split(/\s+/).filter(Boolean);
}

function assertAllValid(ids) {
  for (const id of ids) {
    if (!MOD_ID.test(id)) {
      throw new Error(
        `Refusing to write malformed mod id from config.sh: ${JSON.stringify(id)}. ` +
          'Fix the file manually before continuing.',
      );
    }
  }
}

export async function listMods(filePath) {
  const content = await readText(filePath);
  const lines = content.split(/\r?\n/);
  const match = findModListLine(lines);
  if (!match) {
    throw new Error('Could not find `export DSG_MOD_LIST="..."` line in config.sh');
  }
  return parseInner(match.inner);
}

export async function addMod(filePath, id) {
  if (!isValidModId(id)) throw new Error('Invalid mod id');

  const content = await readText(filePath);
  const trailingNewline = content.endsWith('\n');
  const lines = content.split(/\r?\n/);
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();

  const match = findModListLine(lines);
  if (!match) throw new Error('Could not find `export DSG_MOD_LIST="..."` line in config.sh');

  const current = parseInner(match.inner);
  if (current.includes(id)) {
    return { changed: false, reason: 'already-present', mods: current, backupPath: null };
  }

  const next = [...current, id];
  // Defense in depth: re-validate every value we're about to write.
  assertAllValid(next);

  lines[match.index] = renderLine(match.leading, next, match.trailing);
  const newContent = lines.join('\n') + (trailingNewline ? '\n' : '\n');
  const backupPath = await writeAtomicWithBackup(filePath, newContent);
  return { changed: true, mods: next, backupPath };
}

export async function removeMod(filePath, id) {
  if (!isValidModId(id)) throw new Error('Invalid mod id');

  const content = await readText(filePath);
  const trailingNewline = content.endsWith('\n');
  const lines = content.split(/\r?\n/);
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();

  const match = findModListLine(lines);
  if (!match) throw new Error('Could not find `export DSG_MOD_LIST="..."` line in config.sh');

  const current = parseInner(match.inner);
  if (!current.includes(id)) {
    return { changed: false, reason: 'not-found', mods: current, backupPath: null };
  }

  const next = current.filter((m) => m !== id);
  assertAllValid(next);

  lines[match.index] = renderLine(match.leading, next, match.trailing);
  const newContent = lines.join('\n') + (trailingNewline ? '\n' : '\n');
  const backupPath = await writeAtomicWithBackup(filePath, newContent);
  return { changed: true, mods: next, backupPath };
}

import { readText, writeAtomicWithBackup } from './atomicFile.js';
import { classifyPlayerId } from './validation.js';

export const TRAIN_ADMINS_GROUP = 'TrainAdmin';

// Matches exactly one admin line. Captures: 1=id, 2=group.
// Squad allows optional whitespace around `=` and `:`, and a trailing `// …` inline comment
// (commonly used to note the player's name). We mirror that here but re-validate the id afterwards.
const ADMIN_LINE = /^\s*Admin\s*=\s*([^:\s]+)\s*:\s*(\S+)\s*(?:\/\/.*)?$/;

function parseAdminLine(line) {
  const m = line.match(ADMIN_LINE);
  if (!m) return null;
  const classification = classifyPlayerId(m[1]);
  if (!classification) return null;
  return { id: classification.value, idType: classification.type, group: m[2] };
}

function formatAdminLine(id, group) {
  return `Admin=${id}:${group}`;
}

export async function listTrainAdmin(filePath) {
  const content = await readText(filePath);
  const out = [];
  for (const line of content.split(/\r?\n/)) {
    const parsed = parseAdminLine(line);
    if (parsed && parsed.group === TRAIN_ADMINS_GROUP) {
      out.push({ id: parsed.id, idType: parsed.idType });
    }
  }
  return out;
}

function idExists(lines, id) {
  for (const line of lines) {
    const parsed = parseAdminLine(line);
    if (parsed && parsed.id === id && parsed.group === TRAIN_ADMINS_GROUP) return true;
  }
  return false;
}

export async function addTrainAdmin(filePath, id) {
  // Defense in depth: re-validate the id right before writing.
  const classification = classifyPlayerId(id);
  if (!classification) throw new Error('Invalid player id');

  const content = await readText(filePath);
  const trailingNewline = content.endsWith('\n');
  const lines = content.split(/\r?\n/);

  // Strip a single trailing empty string from the split so we append cleanly.
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();

  if (idExists(lines, classification.value)) {
    return { changed: false, reason: 'already-present', backupPath: null };
  }

  lines.push(formatAdminLine(classification.value, TRAIN_ADMINS_GROUP));
  const newContent = lines.join('\n') + (trailingNewline ? '\n' : '\n');
  const backupPath = await writeAtomicWithBackup(filePath, newContent);
  return { changed: true, backupPath };
}

export async function removeTrainAdmin(filePath, id) {
  const classification = classifyPlayerId(id);
  if (!classification) throw new Error('Invalid player id');

  const content = await readText(filePath);
  const trailingNewline = content.endsWith('\n');
  const lines = content.split(/\r?\n/);
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();

  let removed = 0;
  const kept = [];
  for (const line of lines) {
    const parsed = parseAdminLine(line);
    if (parsed && parsed.id === classification.value && parsed.group === TRAIN_ADMINS_GROUP) {
      removed += 1;
      continue;
    }
    kept.push(line);
  }

  if (removed === 0) {
    return { changed: false, reason: 'not-found', backupPath: null };
  }

  const newContent = kept.join('\n') + (trailingNewline ? '\n' : '\n');
  const backupPath = await writeAtomicWithBackup(filePath, newContent);
  return { changed: true, removedCount: removed, backupPath };
}

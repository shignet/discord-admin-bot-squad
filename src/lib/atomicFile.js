import { readFile, writeFile, rename, copyFile, readdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

const BACKUP_RETENTION = 10;

function timestampSuffix() {
  const d = new Date();
  const pad = (n, w = 2) => String(n).padStart(w, '0');
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}-` +
    `${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`
  );
}

export async function readText(filePath) {
  return readFile(filePath, 'utf8');
}

// Writes atomically: copy original to timestamped backup, write new contents to a tmp file in the same
// directory, then rename over the original. rename() is atomic within a filesystem on POSIX.
export async function writeAtomicWithBackup(filePath, newContent) {
  const dir = path.dirname(filePath);
  const base = path.basename(filePath);

  const backupPath = path.join(dir, `${base}.bak.${timestampSuffix()}`);
  await copyFile(filePath, backupPath);

  const tmpPath = path.join(dir, `.${base}.tmp.${randomBytes(6).toString('hex')}`);
  await writeFile(tmpPath, newContent, { encoding: 'utf8', mode: 0o640 });
  await rename(tmpPath, filePath);

  await pruneBackups(dir, base);
  return backupPath;
}

async function pruneBackups(dir, base) {
  const prefix = `${base}.bak.`;
  const entries = await readdir(dir, { withFileTypes: true });
  const backups = entries
    .filter((e) => e.isFile() && e.name.startsWith(prefix))
    .map((e) => e.name)
    .sort();
  const excess = backups.length - BACKUP_RETENTION;
  if (excess <= 0) return;
  for (const name of backups.slice(0, excess)) {
    await unlink(path.join(dir, name)).catch(() => {});
  }
}

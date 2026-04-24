import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { makeTempFile } from './helpers/tempFile.js';
import { readText, writeAtomicWithBackup } from '../src/lib/atomicFile.js';

let cleanups = [];
afterEach(async () => {
  await Promise.all(cleanups.map((fn) => fn().catch(() => {})));
  cleanups = [];
});

async function setup(name, contents) {
  const tmp = await makeTempFile(name, contents);
  cleanups.push(tmp.cleanup);
  return tmp;
}

test('readText reads utf-8 content verbatim', async () => {
  const { filePath } = await setup('a.txt', 'hello\nworld\n');
  assert.equal(await readText(filePath), 'hello\nworld\n');
});

test('writeAtomicWithBackup writes new content and returns a backup path', async () => {
  const { filePath } = await setup('a.txt', 'original\n');
  const backupPath = await writeAtomicWithBackup(filePath, 'updated\n');

  const live = await readFile(filePath, 'utf8');
  assert.equal(live, 'updated\n');

  const backup = await readFile(backupPath, 'utf8');
  assert.equal(backup, 'original\n', 'backup retains original pre-change content');
});

test('writeAtomicWithBackup creates a timestamped backup next to the file', async () => {
  const { filePath, dir } = await setup('a.txt', 'v1');
  const backupPath = await writeAtomicWithBackup(filePath, 'v2');

  assert.equal(path.dirname(backupPath), dir, 'backup sits beside the file');
  assert.match(path.basename(backupPath), /^a\.txt\.bak\.\d{8}-\d{6}$/);
});

test('writeAtomicWithBackup leaves no stray tmp files on success', async () => {
  const { filePath, dir } = await setup('a.txt', 'v1');
  await writeAtomicWithBackup(filePath, 'v2');

  const entries = await readdir(dir);
  assert.ok(!entries.some((n) => n.startsWith('.a.txt.tmp.')), 'tmp file has been renamed away');
});

test('writeAtomicWithBackup prunes backups beyond the retention limit', async () => {
  const { filePath, dir } = await setup('a.txt', 'v0');

  // The helper writes one backup per call. Run more times than retention keeps to force pruning.
  // Backups are named by UTC second — stagger writes so filenames differ.
  for (let i = 0; i < 12; i += 1) {
    await writeAtomicWithBackup(filePath, `v${i + 1}`);
    await new Promise((r) => setTimeout(r, 1100));
  }

  const entries = await readdir(dir);
  const backups = entries.filter((n) => n.startsWith('a.txt.bak.'));
  assert.ok(backups.length <= 10, `expected <=10 backups after pruning, got ${backups.length}`);
});

test('writeAtomicWithBackup keeps file write-restricted (no world-read)', async () => {
  // Sanity check on the explicit 0o640 mode. Skip on non-POSIX where mode bits are less meaningful.
  if (process.platform === 'win32') return;
  const { filePath } = await setup('a.txt', 'x');
  await writeAtomicWithBackup(filePath, 'y');
  const s = await stat(filePath);
  assert.equal(s.mode & 0o007, 0, 'others must have no permissions');
});

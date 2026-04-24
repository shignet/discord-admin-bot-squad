import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { makeTempFile } from './helpers/tempFile.js';
import { listMods, addMod, removeMod } from '../src/lib/configSh.js';

const BASE_SH = [
  '#!/bin/bash',
  '# Squad server config for supporter-train',
  '',
  'export SQUAD_PORT=7787',
  'export DSG_MOD_LIST="3193475024 3193475888 3193475999"',
  'export LOG_DIR="/var/log/squad"',
  '',
  'echo "Starting $SQUAD_INSTANCE"',
  '',
].join('\n');

let cleanups = [];
afterEach(async () => {
  await Promise.all(cleanups.map((fn) => fn().catch(() => {})));
  cleanups = [];
});

async function setup(initial = BASE_SH) {
  const tmp = await makeTempFile('config.sh', initial);
  cleanups.push(tmp.cleanup);
  return tmp;
}

test('listMods returns the current DSG_MOD_LIST entries', async () => {
  const { filePath } = await setup();
  const mods = await listMods(filePath);
  assert.deepEqual(mods, ['3193475024', '3193475888', '3193475999']);
});

test('listMods throws when DSG_MOD_LIST line is absent', async () => {
  const { filePath } = await setup('#!/bin/bash\nexport OTHER=1\n');
  await assert.rejects(() => listMods(filePath), /DSG_MOD_LIST/);
});

test('addMod appends an ID and preserves every other line verbatim', async () => {
  const { filePath } = await setup();
  const result = await addMod(filePath, '4000000000');

  assert.equal(result.changed, true);
  assert.deepEqual(result.mods, ['3193475024', '3193475888', '3193475999', '4000000000']);

  const content = await readFile(filePath, 'utf8');
  const lines = content.split('\n');
  assert.equal(lines[0], '#!/bin/bash');
  assert.equal(lines[1], '# Squad server config for supporter-train');
  assert.equal(lines[3], 'export SQUAD_PORT=7787');
  assert.equal(lines[4], 'export DSG_MOD_LIST="3193475024 3193475888 3193475999 4000000000"');
  assert.equal(lines[5], 'export LOG_DIR="/var/log/squad"');
  assert.equal(lines[7], 'echo "Starting $SQUAD_INSTANCE"');
  assert.ok(content.endsWith('\n'));
});

test('addMod is idempotent when ID already present', async () => {
  const { filePath } = await setup();
  const result = await addMod(filePath, '3193475888');

  assert.equal(result.changed, false);
  assert.equal(result.reason, 'already-present');
  const content = await readFile(filePath, 'utf8');
  assert.equal(content, BASE_SH);
});

test('addMod rejects invalid mod ids', async () => {
  const { filePath } = await setup();
  await assert.rejects(() => addMod(filePath, ''), /Invalid mod id/);
  await assert.rejects(() => addMod(filePath, 'abc'), /Invalid mod id/);
  await assert.rejects(() => addMod(filePath, '123 456'), /Invalid mod id/);
  await assert.rejects(() => addMod(filePath, '123\n456'), /Invalid mod id/);
  await assert.rejects(() => addMod(filePath, '"; rm -rf /'), /Invalid mod id/);
  await assert.rejects(() => addMod(filePath, '$(whoami)'), /Invalid mod id/);

  const content = await readFile(filePath, 'utf8');
  assert.equal(content, BASE_SH, 'file unchanged after rejections');
});

test('addMod rejects quote-escape injection that would break shell parsing', async () => {
  // If validation were looser, "123\"456" could escape the surrounding quotes in the
  // DSG_MOD_LIST export. MOD_ID regex allows only digits, so this must be rejected.
  const { filePath } = await setup();
  await assert.rejects(() => addMod(filePath, '123"456'), /Invalid mod id/);
  const content = await readFile(filePath, 'utf8');
  assert.equal(content, BASE_SH);
});

test('addMod refuses to write if existing DSG_MOD_LIST contains a malformed entry', async () => {
  // Defense in depth: if the current file is already corrupted, we must not silently "fix"
  // it by writing out a cleaned list. Surface the problem to the operator instead.
  const corrupt = BASE_SH.replace(
    'export DSG_MOD_LIST="3193475024 3193475888 3193475999"',
    'export DSG_MOD_LIST="3193475024 not-a-mod 3193475999"',
  );
  const { filePath } = await setup(corrupt);

  await assert.rejects(() => addMod(filePath, '4000000000'), /malformed mod id/);
  const content = await readFile(filePath, 'utf8');
  assert.equal(content, corrupt, 'file unchanged when pre-existing data is malformed');
});

test('removeMod drops an ID and preserves the rest of the file', async () => {
  const { filePath } = await setup();
  const result = await removeMod(filePath, '3193475888');

  assert.equal(result.changed, true);
  assert.deepEqual(result.mods, ['3193475024', '3193475999']);

  const content = await readFile(filePath, 'utf8');
  const lines = content.split('\n');
  assert.equal(lines[4], 'export DSG_MOD_LIST="3193475024 3193475999"');
  assert.equal(lines[0], '#!/bin/bash');
  assert.equal(lines[3], 'export SQUAD_PORT=7787');
});

test('removeMod is a no-op when id not present', async () => {
  const { filePath } = await setup();
  const result = await removeMod(filePath, '9999999999');
  assert.equal(result.changed, false);
  assert.equal(result.reason, 'not-found');
  const content = await readFile(filePath, 'utf8');
  assert.equal(content, BASE_SH);
});

test('removeMod leaves DSG_MOD_LIST as an empty quoted string when last item removed', async () => {
  const single = BASE_SH.replace(
    'export DSG_MOD_LIST="3193475024 3193475888 3193475999"',
    'export DSG_MOD_LIST="3193475024"',
  );
  const { filePath } = await setup(single);

  const result = await removeMod(filePath, '3193475024');
  assert.equal(result.changed, true);
  assert.deepEqual(result.mods, []);

  const content = await readFile(filePath, 'utf8');
  assert.ok(content.includes('export DSG_MOD_LIST=""'));
});

test('addMod handles leading whitespace on the DSG_MOD_LIST line', async () => {
  const indented = BASE_SH.replace(
    'export DSG_MOD_LIST="3193475024 3193475888 3193475999"',
    '    export DSG_MOD_LIST="3193475024 3193475888 3193475999"',
  );
  const { filePath } = await setup(indented);

  const result = await addMod(filePath, '4000000000');
  assert.equal(result.changed, true);

  const content = await readFile(filePath, 'utf8');
  assert.ok(
    content.includes('    export DSG_MOD_LIST="3193475024 3193475888 3193475999 4000000000"'),
    'leading whitespace preserved',
  );
});

test('addMod preserves trailing content after the closing quote', async () => {
  const withComment = BASE_SH.replace(
    'export DSG_MOD_LIST="3193475024 3193475888 3193475999"',
    'export DSG_MOD_LIST="3193475024 3193475888 3193475999" # maintained by bot',
  );
  const { filePath } = await setup(withComment);

  const result = await addMod(filePath, '4000000000');
  assert.equal(result.changed, true);

  const content = await readFile(filePath, 'utf8');
  assert.ok(content.includes('"3193475024 3193475888 3193475999 4000000000" # maintained by bot'));
});

test('backup file captures the pre-write content on every successful write', async () => {
  const { filePath } = await setup();
  const result = await addMod(filePath, '4000000000');
  assert.ok(result.backupPath);

  const backupContent = await readFile(result.backupPath, 'utf8');
  assert.equal(backupContent, BASE_SH, 'backup contains original pre-change content');
});

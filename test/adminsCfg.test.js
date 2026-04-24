import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { makeTempFile } from './helpers/tempFile.js';
import {
  listTrainAdmins,
  addTrainAdmin,
  removeTrainAdmin,
  TRAIN_ADMINS_GROUP,
} from '../src/lib/adminsCfg.js';

const STEAM_A = '76561198000000001';
const STEAM_B = '76561198000000002';
const EOS_A = '0000000000000000000000000000000a';
const BASE_CFG = [
  'Group=TrainAdmins:ChangeMap,StartVote,Kick,Ban',
  'Group=SuperAdmin:*',
  '',
  '// existing trainadmin',
  `Admin=${STEAM_B}:TrainAdmins`,
  'Admin=76561197999999999:SuperAdmin',
  '',
].join('\n');

let cleanups = [];
afterEach(async () => {
  await Promise.all(cleanups.map((fn) => fn().catch(() => {})));
  cleanups = [];
});

async function setup(initial = BASE_CFG) {
  const tmp = await makeTempFile('Admins.cfg', initial);
  cleanups.push(tmp.cleanup);
  return tmp;
}

test('listTrainAdmins returns only TrainAdmins entries', async () => {
  const { filePath } = await setup();
  const entries = await listTrainAdmins(filePath);
  assert.deepEqual(entries, [{ id: STEAM_B, idType: 'steam' }]);
});

test('addTrainAdmin appends a new Steam entry and preserves other lines', async () => {
  const { filePath } = await setup();
  const result = await addTrainAdmin(filePath, STEAM_A);

  assert.equal(result.changed, true);
  assert.ok(result.backupPath);

  const content = await readFile(filePath, 'utf8');
  assert.ok(content.includes(`Admin=${STEAM_A}:${TRAIN_ADMINS_GROUP}`));
  assert.ok(content.includes('Group=TrainAdmins:'), 'existing group definition preserved');
  assert.ok(content.includes('Group=SuperAdmin:*'), 'unrelated group preserved');
  assert.ok(content.includes(`Admin=${STEAM_B}:TrainAdmins`), 'existing trainadmin preserved');
  assert.ok(content.includes('Admin=76561197999999999:SuperAdmin'), 'unrelated admin preserved');
  assert.ok(content.endsWith('\n'), 'file still ends with newline');
});

test('addTrainAdmin appends a new EOS entry', async () => {
  const { filePath } = await setup();
  const result = await addTrainAdmin(filePath, EOS_A);

  assert.equal(result.changed, true);
  const content = await readFile(filePath, 'utf8');
  assert.ok(content.includes(`Admin=${EOS_A}:${TRAIN_ADMINS_GROUP}`));
});

test('addTrainAdmin is idempotent when id already present', async () => {
  const { filePath } = await setup();
  const result = await addTrainAdmin(filePath, STEAM_B);

  assert.equal(result.changed, false);
  assert.equal(result.reason, 'already-present');
  assert.equal(result.backupPath, null);

  const content = await readFile(filePath, 'utf8');
  assert.equal(content, BASE_CFG, 'file content unchanged when no-op');
});

test('addTrainAdmin rejects malformed Steam ID', async () => {
  const { filePath } = await setup();
  await assert.rejects(() => addTrainAdmin(filePath, '1234567890'), /Invalid player id/);
});

test('addTrainAdmin rejects uppercase EOS ID (no silent normalization)', async () => {
  const { filePath } = await setup();
  await assert.rejects(
    () => addTrainAdmin(filePath, '0000000000000000000000000000000A'),
    /Invalid player id/,
  );
});

test('addTrainAdmin rejects newline-injection attempts', async () => {
  const { filePath } = await setup();
  const injection = `${STEAM_A}\nAdmin=999:SuperAdmin`;
  await assert.rejects(() => addTrainAdmin(filePath, injection), /Invalid player id/);
  const content = await readFile(filePath, 'utf8');
  assert.equal(content, BASE_CFG, 'file content unchanged on rejection');
});

test('removeTrainAdmin removes a TrainAdmin entry', async () => {
  const { filePath } = await setup();
  const result = await removeTrainAdmin(filePath, STEAM_B);

  assert.equal(result.changed, true);
  assert.equal(result.removedCount, 1);
  const content = await readFile(filePath, 'utf8');
  assert.ok(!content.includes(`Admin=${STEAM_B}:TrainAdmins`));
  assert.ok(content.includes('Admin=76561197999999999:SuperAdmin'), 'unrelated admin preserved');
});

test('removeTrainAdmin does NOT remove same id in a different group', async () => {
  const crossGroup = [
    'Group=TrainAdmins:Kick',
    `Admin=${STEAM_A}:SuperAdmin`,
    '',
  ].join('\n');
  const { filePath } = await setup(crossGroup);

  const result = await removeTrainAdmin(filePath, STEAM_A);
  assert.equal(result.changed, false);
  assert.equal(result.reason, 'not-found');
  const content = await readFile(filePath, 'utf8');
  assert.equal(content, crossGroup);
});

test('removeTrainAdmin is a no-op when id not present', async () => {
  const { filePath } = await setup();
  const result = await removeTrainAdmin(filePath, STEAM_A);
  assert.equal(result.changed, false);
  assert.equal(result.reason, 'not-found');
});

test('removeTrainAdmin rejects malformed id', async () => {
  const { filePath } = await setup();
  await assert.rejects(() => removeTrainAdmin(filePath, '; rm -rf /'), /Invalid player id/);
});

test('backup file is created on write and contains the ORIGINAL content', async () => {
  const { filePath, dir } = await setup();
  const result = await addTrainAdmin(filePath, STEAM_A);
  assert.ok(result.backupPath);

  const backupContent = await readFile(result.backupPath, 'utf8');
  assert.equal(backupContent, BASE_CFG, 'backup contains pre-change content');

  const entries = await readdir(dir);
  assert.ok(entries.some((n) => n.startsWith('Admins.cfg.bak.')), 'backup file present');
});

test('listTrainAdmins silently ignores malformed existing admin lines', async () => {
  // Someone hand-edited the file and introduced a malformed id. listTrainAdmins must NOT crash
  // and must NOT surface the malformed entry — it's a read-side defense in depth.
  const bad = [
    'Group=TrainAdmins:Kick',
    'Admin=not-a-valid-id:TrainAdmins',
    `Admin=${STEAM_A}:TrainAdmins`,
    '',
  ].join('\n');
  const { filePath } = await setup(bad);
  const entries = await listTrainAdmins(filePath);
  assert.deepEqual(entries, [{ id: STEAM_A, idType: 'steam' }]);
});

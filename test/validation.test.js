import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  STEAM_ID_64,
  EOS_ID,
  MOD_ID,
  classifyPlayerId,
  isValidModId,
} from '../src/lib/validation.js';

test('STEAM_ID_64 accepts a canonical SteamID64', () => {
  assert.equal(STEAM_ID_64.test('76561198012345678'), true);
});

test('STEAM_ID_64 rejects wrong prefix', () => {
  assert.equal(STEAM_ID_64.test('12345678901234567'), false);
  assert.equal(STEAM_ID_64.test('86561198012345678'), false);
});

test('STEAM_ID_64 rejects wrong length', () => {
  assert.equal(STEAM_ID_64.test('7656119801234567'), false);    // 16 digits
  assert.equal(STEAM_ID_64.test('765611980123456789'), false);  // 18 digits
  assert.equal(STEAM_ID_64.test(''), false);
});

test('STEAM_ID_64 rejects non-digits and whitespace', () => {
  assert.equal(STEAM_ID_64.test('7656119801234567a'), false);
  assert.equal(STEAM_ID_64.test('76561198012345678 '), false);
  assert.equal(STEAM_ID_64.test(' 76561198012345678'), false);
  assert.equal(STEAM_ID_64.test('76561198\t12345678'), false);
});

test('STEAM_ID_64 rejects newline-based injection attempts', () => {
  assert.equal(STEAM_ID_64.test('76561198012345678\nAdmin=999:Super'), false);
  assert.equal(STEAM_ID_64.test('76561198012345678\r\nAdmin=999:Super'), false);
  assert.equal(STEAM_ID_64.test('76561198012345678\x00'), false);
});

test('EOS_ID accepts 32 lowercase hex chars', () => {
  assert.equal(EOS_ID.test('0002a5d4d4e84aaa9b3f6b1a5e2c8d1f'), true);
  assert.equal(EOS_ID.test('0000000000000000000000000000000f'), true);
});

test('EOS_ID rejects uppercase hex', () => {
  assert.equal(EOS_ID.test('0002A5D4D4E84AAA9B3F6B1A5E2C8D1F'), false);
  assert.equal(EOS_ID.test('0002a5d4D4e84aaa9b3f6b1a5e2c8d1f'), false);
});

test('EOS_ID rejects wrong length', () => {
  assert.equal(EOS_ID.test('0002a5d4d4e84aaa9b3f6b1a5e2c8d1'), false);    // 31
  assert.equal(EOS_ID.test('0002a5d4d4e84aaa9b3f6b1a5e2c8d1fa'), false);  // 33
});

test('EOS_ID rejects non-hex chars', () => {
  assert.equal(EOS_ID.test('0002a5d4d4e84aaa9b3f6b1a5e2c8d1g'), false);
  assert.equal(EOS_ID.test('0002a5d4d4e84aaa9b3f6b1a5e2c8d1-'), false);
});

test('EOS_ID rejects whitespace and control chars', () => {
  assert.equal(EOS_ID.test(' 0002a5d4d4e84aaa9b3f6b1a5e2c8d1f'), false);
  assert.equal(EOS_ID.test('0002a5d4d4e84aaa9b3f6b1a5e2c8d1f '), false);
  assert.equal(EOS_ID.test('0002a5d4d4e84aaa9b3f6b1a5e2c8d1f\n'), false);
});

test('MOD_ID accepts digit strings up to 20 chars', () => {
  assert.equal(MOD_ID.test('1'), true);
  assert.equal(MOD_ID.test('3193475024'), true);
  assert.equal(MOD_ID.test('12345678901234567890'), true);
});

test('MOD_ID rejects empty and over-length', () => {
  assert.equal(MOD_ID.test(''), false);
  assert.equal(MOD_ID.test('123456789012345678901'), false); // 21 digits
});

test('MOD_ID rejects non-digits and injection attempts', () => {
  assert.equal(MOD_ID.test('12345 67890'), false);
  assert.equal(MOD_ID.test('12345\n67890'), false);
  assert.equal(MOD_ID.test('12345"67890'), false);
  assert.equal(MOD_ID.test('12345;67890'), false);
  assert.equal(MOD_ID.test('$(id)'), false);
  assert.equal(MOD_ID.test('0x1234'), false);
});

test('classifyPlayerId classifies Steam IDs', () => {
  assert.deepEqual(classifyPlayerId('76561198012345678'), {
    type: 'steam',
    value: '76561198012345678',
  });
});

test('classifyPlayerId classifies EOS IDs', () => {
  assert.deepEqual(classifyPlayerId('0002a5d4d4e84aaa9b3f6b1a5e2c8d1f'), {
    type: 'eos',
    value: '0002a5d4d4e84aaa9b3f6b1a5e2c8d1f',
  });
});

test('classifyPlayerId rejects invalid input', () => {
  assert.equal(classifyPlayerId(''), null);
  assert.equal(classifyPlayerId('not-an-id'), null);
  assert.equal(classifyPlayerId(null), null);
  assert.equal(classifyPlayerId(undefined), null);
  assert.equal(classifyPlayerId(76561198012345678), null);   // number, not string
  assert.equal(classifyPlayerId('76561198012345678\n'), null);
  assert.equal(classifyPlayerId('76561198012345678 '), null);
});

test('classifyPlayerId does not coerce uppercase EOS input', () => {
  assert.equal(classifyPlayerId('0002A5D4D4E84AAA9B3F6B1A5E2C8D1F'), null);
});

test('isValidModId matches MOD_ID regex', () => {
  assert.equal(isValidModId('3193475024'), true);
  assert.equal(isValidModId(''), false);
  assert.equal(isValidModId(null), false);
  assert.equal(isValidModId(3193475024), false); // must be string
  assert.equal(isValidModId('3193475024 3193475888'), false);
});

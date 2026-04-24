import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ALLOWED_ACTIONS,
  assertAllowedAction,
  assertAllowedService,
  isValidSystemdUnitName,
  parseServiceList,
} from '../src/lib/systemctlGuard.js';

test('ALLOWED_ACTIONS contains exactly the five expected verbs', () => {
  assert.deepEqual(
    [...ALLOWED_ACTIONS].sort(),
    ['is-active', 'restart', 'start', 'status', 'stop'],
  );
});

test('ALLOWED_ACTIONS is frozen — mutation attempts throw in strict mode', () => {
  assert.throws(() => ALLOWED_ACTIONS.push('enable'), TypeError);
  assert.throws(() => { ALLOWED_ACTIONS[0] = 'enable'; }, TypeError);
});

test('assertAllowedAction is not influenced by prototype pollution', () => {
  const original = Object.prototype.enable;
  try {
    // eslint-disable-next-line no-extend-native
    Object.prototype.enable = true;
    assert.throws(() => assertAllowedAction('enable'), /Disallowed systemctl action/);
  } finally {
    if (original === undefined) delete Object.prototype.enable;
    else Object.prototype.enable = original;
  }
});

test('assertAllowedAction accepts every allowed verb', () => {
  for (const action of ALLOWED_ACTIONS) {
    assert.doesNotThrow(() => assertAllowedAction(action));
  }
});

test('assertAllowedAction rejects dangerous verbs', () => {
  for (const bad of ['enable', 'disable', 'mask', 'unmask', 'reload', 'daemon-reload', 'kill']) {
    assert.throws(() => assertAllowedAction(bad), /Disallowed systemctl action/);
  }
});

test('assertAllowedAction rejects injection-shaped strings', () => {
  for (const bad of [
    'start; rm -rf /',
    'start && reboot',
    'start\nstop',
    'start ',
    ' start',
    'START',
    'Start',
    '',
  ]) {
    assert.throws(() => assertAllowedAction(bad), /Disallowed systemctl action/);
  }
});

test('assertAllowedAction rejects non-string input', () => {
  for (const bad of [null, undefined, 42, {}, [], Symbol('start')]) {
    assert.throws(() => assertAllowedAction(bad), /Disallowed systemctl action/);
  }
});

test('assertAllowedAction rejects prototype-chain names like __proto__, constructor', () => {
  for (const bad of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
    assert.throws(() => assertAllowedAction(bad), /Disallowed systemctl action/);
  }
});

// --- isValidSystemdUnitName ---

test('isValidSystemdUnitName accepts typical units', () => {
  assert.equal(isValidSystemdUnitName('squad-train.service'), true);
  assert.equal(isValidSystemdUnitName('squad-public.service'), true);
  assert.equal(isValidSystemdUnitName('foo@bar.service'), true);
  assert.equal(isValidSystemdUnitName('my.timer'), true);
  assert.equal(isValidSystemdUnitName('my.target'), true);
  assert.equal(isValidSystemdUnitName('my.socket'), true);
});

test('isValidSystemdUnitName rejects units without a known suffix', () => {
  assert.equal(isValidSystemdUnitName('squad-train'), false);
  assert.equal(isValidSystemdUnitName('squad-train.mount'), false);
  assert.equal(isValidSystemdUnitName('squad-train.path'), false);
});

test('isValidSystemdUnitName rejects whitespace and shell metacharacters', () => {
  assert.equal(isValidSystemdUnitName('squad-train.service '), false);
  assert.equal(isValidSystemdUnitName(' squad-train.service'), false);
  assert.equal(isValidSystemdUnitName('squad-train.service;rm'), false);
  assert.equal(isValidSystemdUnitName('squad-train.service\nrm'), false);
  assert.equal(isValidSystemdUnitName('squad-train.service|rm'), false);
  assert.equal(isValidSystemdUnitName('squad-train.service$(id)'), false);
});

test('isValidSystemdUnitName rejects non-strings', () => {
  assert.equal(isValidSystemdUnitName(null), false);
  assert.equal(isValidSystemdUnitName(undefined), false);
  assert.equal(isValidSystemdUnitName(42), false);
});

// --- parseServiceList ---

test('parseServiceList parses a single entry', () => {
  const list = parseServiceList('squad-train.service');
  assert.deepEqual([...list], ['squad-train.service']);
});

test('parseServiceList parses multiple comma-separated entries and trims whitespace', () => {
  const list = parseServiceList(' squad-train.service , squad-public.service ');
  assert.deepEqual([...list], ['squad-train.service', 'squad-public.service']);
});

test('parseServiceList returns a frozen array', () => {
  const list = parseServiceList('squad-train.service');
  assert.throws(() => list.push('squad-public.service'), TypeError);
});

test('parseServiceList rejects empty/whitespace/null input', () => {
  assert.throws(() => parseServiceList(''), /non-empty/);
  assert.throws(() => parseServiceList('   '), /non-empty/);
  assert.throws(() => parseServiceList(','), /at least one/);
  assert.throws(() => parseServiceList(null), /non-empty/);
  assert.throws(() => parseServiceList(undefined), /non-empty/);
});

test('parseServiceList rejects a list containing any malformed entry', () => {
  assert.throws(
    () => parseServiceList('squad-train.service,evil;rm -rf /'),
    /invalid unit name/,
  );
  assert.throws(() => parseServiceList('squad-train'), /invalid unit name/);
  assert.throws(() => parseServiceList('squad-train.service, squad-public'), /invalid unit name/);
});

test('parseServiceList rejects duplicate entries', () => {
  assert.throws(
    () => parseServiceList('squad-train.service,squad-train.service'),
    /duplicate/,
  );
});

// --- assertAllowedService ---

test('assertAllowedService accepts a service in the allowlist', () => {
  const allow = ['squad-train.service', 'squad-public.service'];
  assert.doesNotThrow(() => assertAllowedService('squad-train.service', allow));
  assert.doesNotThrow(() => assertAllowedService('squad-public.service', allow));
});

test('assertAllowedService rejects a service not in the allowlist', () => {
  const allow = ['squad-train.service'];
  assert.throws(
    () => assertAllowedService('squad-public.service', allow),
    /not in configured allowlist/,
  );
});

test('assertAllowedService rejects malformed unit names even if they happen to be in the allowlist', () => {
  // Even a tampered allowlist should be caught by the unit-name regex first.
  const allow = ['squad-train.service;evil'];
  assert.throws(
    () => assertAllowedService('squad-train.service;evil', allow),
    /Disallowed systemctl unit name/,
  );
});

test('assertAllowedService rejects empty allowlist', () => {
  assert.throws(
    () => assertAllowedService('squad-train.service', []),
    /No allowed services configured/,
  );
  assert.throws(
    () => assertAllowedService('squad-train.service', null),
    /No allowed services configured/,
  );
});

test('assertAllowedService rejects non-string service input', () => {
  const allow = ['squad-train.service'];
  for (const bad of [null, undefined, 42, {}, []]) {
    assert.throws(() => assertAllowedService(bad, allow), /Disallowed systemctl unit name/);
  }
});

test('assertAllowedService rejects shell-metachar injection in the service arg', () => {
  const allow = ['squad-train.service'];
  for (const bad of [
    'squad-train.service; rm -rf /',
    'squad-train.service\nsquad-public.service',
    'squad-train.service && halt',
    ' squad-train.service',
    'squad-train.service ',
  ]) {
    assert.throws(() => assertAllowedService(bad, allow), /Disallowed systemctl unit name/);
  }
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSystemctlStatus, extractLogTail, buildStatusEmbed } from '../src/lib/statusFormat.js';

const ACTIVE_SAMPLE = `● squad-server-1.service - Squad Dedicated Server (instance 1)
     Loaded: loaded (/etc/systemd/system/squad-server-1.service; enabled; vendor preset: enabled)
     Active: active (running) since Mon 2026-04-29 12:34:56 UTC; 1h 23min ago
   Main PID: 4242 (SquadGameServer)
      Tasks: 38 (limit: 9830)
     Memory: 4.1G
        CPU: 1h 5min 12s
     CGroup: /system.slice/squad-server-1.service
             └─4242 /opt/squad/SquadGameServer Port=7787

Apr 29 13:55:01 host SquadGameServer[4242]: Player joined: Alice
Apr 29 13:55:12 host SquadGameServer[4242]: Player left: Bob
`;

const FAILED_SAMPLE = `× squad-server-2.service - Squad Dedicated Server (instance 2)
     Loaded: loaded (/etc/systemd/system/squad-server-2.service; enabled; vendor preset: enabled)
     Active: failed (Result: exit-code) since Mon 2026-04-29 12:00:00 UTC; 5min ago
   Main PID: 1111 (code=exited, status=1/FAILURE)
        CPU: 12.345s

Apr 29 12:00:00 host systemd[1]: squad-server-2.service: Main process exited, code=exited, status=1/FAILURE
Apr 29 12:00:00 host systemd[1]: squad-server-2.service: Failed with result 'exit-code'.
`;

const INACTIVE_SAMPLE = `○ squadjs-public.service - SquadJS public instance
     Loaded: loaded (/etc/systemd/system/squadjs-public.service; disabled; vendor preset: enabled)
     Active: inactive (dead)
`;

test('parseSystemctlStatus: extracts header, active, resources for an active unit', () => {
  const p = parseSystemctlStatus(ACTIVE_SAMPLE);
  assert.equal(p.unit, 'squad-server-1.service');
  assert.equal(p.description, 'Squad Dedicated Server (instance 1)');
  assert.equal(p.loadState, 'loaded');
  assert.equal(p.enabled, 'enabled');
  assert.equal(p.activeState, 'active');
  assert.equal(p.subState, 'running');
  assert.match(p.since, /Mon 2026-04-29/);
  assert.equal(p.uptime, '1h 23min ago');
  assert.equal(p.mainPid, 4242);
  assert.equal(p.mainProc, 'SquadGameServer');
  assert.equal(p.tasks, '38 / 9830');
  assert.equal(p.memory, '4.1G');
  assert.equal(p.cpu, '1h 5min 12s');
});

test('parseSystemctlStatus: handles failed unit', () => {
  const p = parseSystemctlStatus(FAILED_SAMPLE);
  assert.equal(p.activeState, 'failed');
  assert.equal(p.subState, 'Result: exit-code');
  assert.equal(p.uptime, '5min ago');
  assert.equal(p.cpu, '12.345s');
});

test('parseSystemctlStatus: handles inactive unit with no resources', () => {
  const p = parseSystemctlStatus(INACTIVE_SAMPLE);
  assert.equal(p.activeState, 'inactive');
  assert.equal(p.subState, 'dead');
  assert.equal(p.mainPid, null);
  assert.equal(p.memory, null);
});

test('parseSystemctlStatus: never throws on garbage input', () => {
  for (const v of [null, undefined, '', '   ', 42, {}]) {
    const p = parseSystemctlStatus(v);
    assert.equal(p.activeState, 'unknown');
  }
});

test('extractLogTail: returns trailing log lines after metadata', () => {
  const tail = extractLogTail(ACTIVE_SAMPLE, 5);
  assert.match(tail, /Player joined: Alice/);
  assert.match(tail, /Player left: Bob/);
});

test('extractLogTail: empty when no log section present', () => {
  assert.equal(extractLogTail(INACTIVE_SAMPLE, 5), '');
});

test('buildStatusEmbed: produces a green embed for an active unit', () => {
  const embed = buildStatusEmbed({
    commandLabel: 'Squad server',
    instance: 'squad-server-1.service',
    raw: ACTIVE_SAMPLE,
  });
  const json = embed.toJSON();
  assert.equal(json.color, 0x2ecc71);
  assert.match(json.title, /squad-server-1\.service/);
  assert.match(json.description, /Running/);
  const fieldNames = json.fields.map((f) => f.name);
  assert.ok(fieldNames.includes('Uptime'));
  assert.ok(fieldNames.includes('Memory'));
  assert.ok(fieldNames.includes('Recent log'));
});

test('buildStatusEmbed: produces a red embed for a failed unit', () => {
  const embed = buildStatusEmbed({
    commandLabel: 'Squad server',
    instance: 'squad-server-2.service',
    raw: FAILED_SAMPLE,
  });
  const json = embed.toJSON();
  assert.equal(json.color, 0xe74c3c);
  assert.match(json.description, /Failed/);
});

test('buildStatusEmbed: produces a grey embed for an inactive unit', () => {
  const embed = buildStatusEmbed({
    commandLabel: 'Service',
    instance: 'squadjs-public.service',
    raw: INACTIVE_SAMPLE,
  });
  const json = embed.toJSON();
  assert.equal(json.color, 0x95a5a6);
  assert.match(json.description, /Stopped/);
});

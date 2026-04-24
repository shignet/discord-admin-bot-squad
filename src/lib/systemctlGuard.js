// Strict allowlist for systemctl actions. Any value outside this set is rejected BEFORE it reaches execFile.
// Kept config-free so unit tests can import without triggering env validation.
//
// Implementation note: a plain object frozen via Object.freeze is used rather than a Set, because
// Object.freeze() does NOT prevent mutation of Set/Map internals (.add()/.delete() still succeed).
// A frozen plain object with null prototype is genuinely immutable for our purposes, and we gate
// lookups with Object.prototype.hasOwnProperty to avoid prototype pollution tricks.
const ALLOWED = Object.freeze(Object.assign(Object.create(null), {
  start: true,
  stop: true,
  restart: true,
  status: true,
  'is-active': true,
}));

export const ALLOWED_ACTIONS = Object.freeze(Object.keys(ALLOWED));

export function assertAllowedAction(action) {
  if (typeof action !== 'string' || !Object.prototype.hasOwnProperty.call(ALLOWED, action)) {
    throw new Error(`Disallowed systemctl action: ${JSON.stringify(action)}`);
  }
}

// Validates a systemd unit name. Deliberately restrictive — we do NOT accept arbitrary unit names
// even at parse time; the caller still has to assert membership of the configured allowlist afterwards.
const SYSTEMD_UNIT = /^[A-Za-z0-9@._-]+\.(service|target|socket|timer)$/;

export function isValidSystemdUnitName(value) {
  return typeof value === 'string' && SYSTEMD_UNIT.test(value);
}

// Asserts `service` is present in the caller-supplied allowlist (typically derived from SQUAD_SERVICES).
// The allowlist MUST be an array; membership is checked with a plain linear scan on the trusted array.
// This is the primary backend gate — Discord slash-command choices are a UI hint, never relied upon.
export function assertAllowedService(service, allowedServices) {
  if (!Array.isArray(allowedServices) || allowedServices.length === 0) {
    throw new Error('No allowed services configured');
  }
  if (!isValidSystemdUnitName(service)) {
    throw new Error(`Disallowed systemctl unit name: ${JSON.stringify(service)}`);
  }
  if (!allowedServices.includes(service)) {
    throw new Error(`Service not in configured allowlist: ${JSON.stringify(service)}`);
  }
}

// Parses the SQUAD_SERVICES env value (comma-separated list). Each entry is validated and trimmed.
// Returns a frozen array of unique unit names in input order. Throws if any entry is malformed
// or the list is empty.
export function parseServiceList(raw) {
  if (typeof raw !== 'string' || raw.trim() === '') {
    throw new Error('SQUAD_SERVICES must be a non-empty comma-separated list of systemd unit names');
  }
  const entries = raw.split(',').map((s) => s.trim()).filter((s) => s !== '');
  if (entries.length === 0) {
    throw new Error('SQUAD_SERVICES must contain at least one entry');
  }
  const seen = new Set();
  for (const entry of entries) {
    if (!isValidSystemdUnitName(entry)) {
      throw new Error(`SQUAD_SERVICES contains an invalid unit name: ${JSON.stringify(entry)}`);
    }
    if (seen.has(entry)) {
      throw new Error(`SQUAD_SERVICES contains a duplicate entry: ${JSON.stringify(entry)}`);
    }
    seen.add(entry);
  }
  return Object.freeze(entries);
}

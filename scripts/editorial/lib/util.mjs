// Small helpers shared by every packet mode: hashing, SQL quoting, HTML escaping, Eastern time.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

export const SITE = 'https://firelandscurrent.com';
export const hash = data => createHash('sha256').update(data).digest('hex');
export const normalizeText = value => typeof value === 'string' ? value.replaceAll('\r\n', '\n') : value;
export const escapeHtml = value => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
export const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** A SQL literal for a string, number or null. Rows written to production become SQL files, so every value goes through here. */
export function q(value) {
  if (value === null) return 'NULL';
  if (typeof value === 'number') { assert(Number.isFinite(value), 'Non-finite number in SQL'); return String(value); }
  assert.equal(typeof value, 'string', 'Unsupported SQL value');
  return "'" + value.replaceAll("'", "''") + "'";
}
export const idList = rows => rows.length ? rows.map(row => q(row.id)).join(',') : 'NULL';
export const valueList = values => values.length ? values.map(q).join(',') : 'NULL';
export const insertSql = (table, row) => `INSERT INTO ${table} (${Object.keys(row).join(',')}) VALUES (${Object.values(row).map(q).join(',')});`;
export const updateSql = (table, id, fields, guard) => `UPDATE ${table} SET ${Object.entries(fields).map(([key, value]) => key + '=' + q(value)).join(',')} WHERE id=${q(id)} AND ${guard.column}=${q(guard.value)};`;

/** Today's date in Eastern time, which is the newsroom's calendar. */
export const easternDate = (now = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(now);

/** The UTC stamp (`YYYYMMDDTHHMMSSZ`) of an Eastern wall-clock date and time, which is how .ics exports state start times. */
export function easternToIcsUtc(date, time) {
  const [y, mo, d] = date.split('-').map(Number), [h, mi] = time.split(':').map(Number);
  const wall = Date.UTC(y, mo - 1, d, h, mi);
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  const asWall = ms => { const p = Object.fromEntries(parts.formatToParts(ms).map(x => [x.type, x.value])); return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute); };
  let guess = wall + 5 * 3600000;
  guess += wall - asWall(guess);
  return new Date(guess).toISOString().replace(/[-:]/g, '').replace('.000', '');
}

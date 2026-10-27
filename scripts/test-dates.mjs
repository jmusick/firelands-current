import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const source = ts.transpileModule(readFileSync(new URL('../src/lib/dates.ts', import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext },
}).outputText;
const { fmtStoryDate, fmtStoryDateTime, isoDateTime } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

const utc = (...args) => Date.UTC(...args);

test('a published story shows its Eastern time in AP style', () => {
  assert.equal(fmtStoryDateTime(1792936131435), 'Oct. 25, 2026, at 9:48 a.m.');
  assert.equal(fmtStoryDate(1792936131435), 'Oct. 25, 2026');
});

test('a UTC evening that is still the previous day in Eastern time', () => {
  // 02:30 UTC on Oct. 26 is 10:30 p.m. EDT on Oct. 25.
  assert.equal(fmtStoryDate(utc(2026, 9, 26, 2, 30)), 'Oct. 25, 2026');
  assert.equal(fmtStoryDateTime(utc(2026, 9, 26, 2, 30)), 'Oct. 25, 2026, at 10:30 p.m.');
  // Jan. 1 UTC is still Dec. 31 in Eastern time, across a year boundary.
  assert.equal(fmtStoryDate(utc(2027, 0, 1, 3, 0)), 'Dec. 31, 2026');
});

test('both sides of the Nov. 1, 2026 daylight saving change', () => {
  // EDT (UTC-4) until 2 a.m.; 05:59 UTC is 1:59 a.m. EDT, 06:00 UTC is 1:00 a.m. EST.
  assert.equal(fmtStoryDateTime(utc(2026, 10, 1, 5, 59)), 'Nov. 1, 2026, at 1:59 a.m.');
  assert.equal(fmtStoryDateTime(utc(2026, 10, 1, 6, 0)), 'Nov. 1, 2026, at 1 a.m.');
  assert.equal(fmtStoryDateTime(utc(2026, 10, 1, 7, 0)), 'Nov. 1, 2026, at 2 a.m.');
  // Noon UTC is 8 a.m. EDT before the change and 7 a.m. EST after.
  assert.equal(fmtStoryDateTime(utc(2026, 9, 31, 12, 0)), 'Oct. 31, 2026, at 8 a.m.');
  assert.equal(fmtStoryDateTime(utc(2026, 10, 2, 12, 0)), 'Nov. 2, 2026, at 7 a.m.');
});

test('every month uses its AP form', () => {
  const expected = ['Jan.', 'Feb.', 'March', 'April', 'May', 'June', 'July', 'Aug.', 'Sept.', 'Oct.', 'Nov.', 'Dec.'];
  expected.forEach((month, index) => assert.equal(fmtStoryDate(utc(2026, index, 15, 16)), `${month} 15, 2026`));
});

test('noon, midnight, and on-the-hour times', () => {
  assert.equal(fmtStoryDateTime(utc(2026, 6, 4, 16, 0)), 'July 4, 2026, at noon');
  assert.equal(fmtStoryDateTime(utc(2026, 6, 4, 4, 0)), 'July 4, 2026, at midnight');
  assert.equal(fmtStoryDateTime(utc(2026, 6, 4, 13, 0)), 'July 4, 2026, at 9 a.m.');
  assert.equal(fmtStoryDateTime(utc(2026, 6, 4, 21, 0)), 'July 4, 2026, at 5 p.m.');
  assert.equal(fmtStoryDateTime(utc(2026, 6, 4, 16, 5)), 'July 4, 2026, at 12:05 p.m.');
  assert.equal(fmtStoryDateTime(utc(2026, 6, 4, 4, 5)), 'July 4, 2026, at 12:05 a.m.');
});

test('the datetime attribute stays a UTC instant', () => {
  assert.equal(isoDateTime(1792936131435), '2026-10-25T13:48:51.435Z');
});

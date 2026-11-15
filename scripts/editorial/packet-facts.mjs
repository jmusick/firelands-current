// Read-only helper for writing a manifest: prints the values packet.json asks for, from the local database
// (which AGENTS.md keeps matching production), so nobody computes a hash by hand.
//
//   node scripts/editorial/packet-facts.mjs --baseline news_articles <slug> <field,field,...> [--persist-to DIR]
//       the baseline_sha256 for an update that changes those fields of an existing story or event
//   node scripts/editorial/packet-facts.mjs --media <media id> [--persist-to DIR]
//       the stored sha256, caption and credit of a library photo to reuse
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { DEFAULT_STATE, openLocal } from './lib/local.mjs';
import { baselineHash } from './lib/manifest.mjs';
import { hash } from './lib/util.mjs';

const args = process.argv.slice(2);
const persistAt = args.indexOf('--persist-to');
const stateDir = persistAt >= 0 ? resolve(args.splice(persistAt, 2)[1]) : DEFAULT_STATE;
const local = await openLocal(stateDir);
try {
  if (args[0] === '--baseline' && args.length === 4) {
    const [, table, slug, fields] = args;
    assert(['news_articles', 'events'].includes(table), 'table must be news_articles or events');
    const row = await local.db.prepare(`SELECT * FROM ${table} WHERE slug=?`).bind(slug).first();
    assert(row, 'No such row: ' + slug);
    const names = fields.split(',');
    assert(names.every(name => name in row), 'Unknown field in: ' + fields);
    console.log(JSON.stringify({ table, slug, fields: names, baseline_sha256: baselineHash(row, names) }, null, 2));
  } else if (args[0] === '--media' && args.length === 2) {
    const record = await local.db.prepare('SELECT * FROM media WHERE id=?').bind(args[1]).first();
    assert(record, 'No such media id: ' + args[1]);
    const object = await local.env.MEDIA.get(record.object_key);
    assert(object, 'The photo is missing from the local bucket: ' + record.object_key);
    console.log(JSON.stringify({ id: record.id, object_key: record.object_key, sha256: hash(new Uint8Array(await object.arrayBuffer())), caption: record.caption, credit: record.credit, alt: record.alt }, null, 2));
  } else assert.fail('usage: packet-facts.mjs --baseline <table> <slug> <fields> | --media <id>  [--persist-to DIR]');
} finally {
  await local.dispose();
}

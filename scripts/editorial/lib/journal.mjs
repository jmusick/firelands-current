// Journal and evidence files for one packet. They go in the packet's project-library folder by default,
// next to the manifest, which is where the dated scripts kept theirs. `--journal-dir` redirects them
// (rehearsals on a throwaway copy write somewhere disposable); manifest, inputs and images are still read from the packet folder.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { editorialDirectory, repositoryDirectory } from '../../project-library.mjs';

export function packetDirectory(date) {
  return resolve(editorialDirectory(date));
}

export function openJournal(date, journalDir) {
  const packetDir = packetDirectory(date);
  const dir = journalDir ? resolve(journalDir) : packetDir;
  assert(!resolve(dir).startsWith(resolve(repositoryDirectory)) || dir === packetDir, 'Journals belong in the project library or a scratch folder, not the repository');
  mkdirSync(join(dir, 'evidence'), { recursive: true });
  mkdirSync(join(dir, 'images'), { recursive: true });
  const at = name => join(dir, name);
  return {
    packetDir, dir, at,
    exists: name => existsSync(at(name)),
    read: name => JSON.parse(readFileSync(at(name), 'utf8')),
    readBytes: name => readFileSync(at(name)),
    save: (name, value) => writeFileSync(at(name), JSON.stringify(value, null, 2) + '\n'),
    create: (name, value) => writeFileSync(at(name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' }),
    saveText: (name, text) => writeFileSync(at(name), text),
    saveBytes: (name, bytes) => writeFileSync(at(name), bytes),
  };
}

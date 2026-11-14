import {
  computeMentionParityManifest,
  listMentionParityFiles,
  loadMentionParityFixture,
  MENTION_CONTRACT_VERSION,
  MENTION_PARITY_MANIFEST,
  mentionParityByteRuleViolations,
  readMentionParityFile,
} from './mention-parity-helpers';

/**
 * The folder is a byte-identical copy of AppFlowy-Cloud-Premium's canonical
 * `libs/appflowy-entity/fixtures/mention-parity/` (the typeahead contract's vectors). Any changed
 * byte fails here: change the vectors in Cloud first, then copy the whole folder (its README).
 */
describe('mention-parity fixtures', () => {
  const files = listMentionParityFiles();

  it('hold every file of the contract', () => {
    expect(files).toEqual([
      'FIXTURES.sha256',
      'README.md',
      'cacheability.json',
      'merge.json',
      'normalize.json',
      'people.json',
      'pick-memory.json',
      'rank.json',
      'request.json',
      'schedule.json',
      'tiers.json',
    ]);
  });

  it('match their FIXTURES.sha256 manifest', () => {
    const expected = computeMentionParityManifest();
    const committed = readMentionParityFile(MENTION_PARITY_MANIFEST).toString('utf8');

    if (committed !== expected) {
      // The manifest the files now have, to compare with the canonical copy's.
      throw new Error(`${MENTION_PARITY_MANIFEST} does not match the fixtures. The files now give:\n${expected}`);
    }
  });

  it.each(files)('%s follows the byte rules', (name) => {
    expect(mentionParityByteRuleViolations(name, readMentionParityFile(name))).toEqual([]);
  });

  it('has byte rules that catch what editors do', () => {
    expect(mentionParityByteRuleViolations('a.json', Buffer.from('{}\n'))).toEqual([]);
    const broken: [string, Buffer][] = [
      ['bom', Buffer.from('\ufeff{}\n', 'utf8')],
      ['crlf', Buffer.from('{}\r\n')],
      ['no newline', Buffer.from('{}')],
      ['two newlines', Buffer.from('{}\n\n')],
      ['tab', Buffer.from('{\n\t"a": 1\n}\n')],
      ['odd indent', Buffer.from('{\n   "a": 1\n}\n')],
      ['not json', Buffer.from('{\n')],
      ['latin-1', Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x0a])],
    ];

    broken.forEach(([what, bytes]) => {
      expect([what, mentionParityByteRuleViolations('a.json', bytes).length > 0]).toEqual([what, true]);
    });
  });

  it('are each described by the README', () => {
    const readme = readMentionParityFile('README.md').toString('utf8');

    files.forEach((name) => expect([name, readme.includes(`\`${name}\``)]).toEqual([name, true]));
  });

  it.each(files.filter((name) => name.endsWith('.json')))(
    '%s carries the contract version and unique case ids',
    (name) => {
      const fixture = loadMentionParityFixture<{ version: number; cases?: { id?: string }[] }>(name);
      const ids = (fixture.cases ?? []).map((entry) => entry.id);

      expect(fixture.version).toBe(MENTION_CONTRACT_VERSION);
      ids.forEach((id) => expect(typeof id).toBe('string'));
      expect(new Set(ids).size).toBe(ids.length);
    }
  );
});

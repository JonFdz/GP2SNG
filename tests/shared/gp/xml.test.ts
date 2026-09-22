import { describe, expect, it } from 'vitest';
import { attr, child, parseXml, text, toArray } from '../../../src/shared/gp/xml';

const XML = `<Root>
  <Score><Title><![CDATA[Hello]]></Title><Empty><![CDATA[]]></Empty></Score>
  <List><Item id="1"/><Item id="2"/></List>
  <Single><Item id="9"/></Single>
  <Repeat start="true" count="4"/>
  <Ids>3 7 12</Ids>
</Root>`;

describe('xml helpers', () => {
  const doc = parseXml(XML);
  const root = child(doc, 'Root');

  it('reads CDATA text trimmed, empty CDATA as empty string', () => {
    expect(text(child(child(root, 'Score'), 'Title'))).toBe('Hello');
    expect(text(child(child(root, 'Score'), 'Empty'))).toBe('');
    expect(text(child(root, 'Missing'))).toBe('');
  });

  it('toArray normalizes one-vs-many children', () => {
    expect(toArray(child(child(root, 'List'), 'Item'))).toHaveLength(2);
    expect(toArray(child(child(root, 'Single'), 'Item'))).toHaveLength(1);
    expect(toArray(child(root, 'Missing'))).toEqual([]);
  });

  it('reads attributes as strings, undefined when absent', () => {
    expect(attr(child(root, 'Repeat'), 'start')).toBe('true');
    expect(attr(child(root, 'Repeat'), 'count')).toBe('4');
    expect(attr(child(root, 'Repeat'), 'end')).toBeUndefined();
  });

  it('reads a space-separated id list as text', () => {
    expect(text(child(root, 'Ids'))).toBe('3 7 12');
  });

  it('preserves ordinary escaped XML text', () => {
    expect(text(child(parseXml('<Root>Tom &amp; Cymbal &lt;3</Root>'), 'Root'))).toBe(
      'Tom & Cymbal <3',
    );
  });

  it('rejects excessive XML nesting', () => {
    const nested = `${'<N>'.repeat(258)}x${'</N>'.repeat(258)}`;
    expect(() => parseXml(nested)).toThrow(/nested tags/i);
  });

  it('rejects excessive entity expansions', () => {
    const xml = `<!DOCTYPE R [<!ENTITY x "x">]><R>${'&x;'.repeat(100_001)}</R>`;
    expect(() => parseXml(xml)).toThrow(/expansion count limit/i);
  });
});

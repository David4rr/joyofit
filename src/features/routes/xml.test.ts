import { describe, expect, test } from 'bun:test';

import { decodeEntities, localName, parseAttrs, parseNumber, scanXml } from './xml';

function events(xml: string): string[] {
  const out: string[] = [];
  scanXml(xml, {
    open: (name, attrs, selfClosing) => out.push(`<${name}${selfClosing ? '/' : ''}${attrs.trim() ? ` ${attrs.trim()}` : ''}>`),
    close: (name) => out.push(`</${name}>`),
    text: (text) => out.push(`"${text}"`),
  });
  return out;
}

describe('localName', () => {
  test('drops the prefix and lower-cases', () => {
    expect(localName('gpxtpx:HR')).toBe('hr');
    expect(localName('TrainingCenterDatabase')).toBe('trainingcenterdatabase');
  });
});

describe('decodeEntities', () => {
  test('named and numeric references', () => {
    expect(decodeEntities('a &amp; b &lt;c&gt; &quot;d&quot; &apos;e&apos;')).toBe('a & b <c> "d" \'e\'');
    expect(decodeEntities('&#66;&#x42;&#x1F600;')).toBe('BB\u{1F600}');
  });
  test('leaves unknown or invalid references as written', () => {
    expect(decodeEntities('&nbsp; &#0; &#xD800; &unknown;')).toBe('&nbsp; &#0; &#xD800; &unknown;');
  });
});

describe('parseAttrs', () => {
  test('either quote, prefixes dropped, entities decoded', () => {
    expect(parseAttrs(` lat="-7.5"  lon='112.5' xsi:type="a&amp;b"`)).toEqual({ lat: '-7.5', lon: '112.5', type: 'a&b' });
  });
});

describe('parseNumber', () => {
  test('empty and missing are NaN', () => {
    expect(parseNumber(undefined)).toBeNaN();
    expect(parseNumber('  ')).toBeNaN();
    expect(parseNumber(' 12.5 ')).toBe(12.5);
  });
});

describe('scanXml', () => {
  test('tags, text and self-closing tags in order', () => {
    expect(events('<?xml version="1.0"?><a x="1"><b/>hello<c>  </c></a>')).toEqual(['<a x="1">', '<b/>', '</b>', '"hello"', '<c>', '</c>', '</a>']);
  });
  test('comments are skipped, CDATA is text as it is', () => {
    expect(events('<a><!-- <b> --><![CDATA[x < y & z]]></a>')).toEqual(['<a>', '"x < y & z"', '</a>']);
  });
  test('a > inside a quoted attribute does not end the tag', () => {
    expect(events('<p note="a>b" k=\'x>y\'/>')).toEqual(['<p/ note="a>b" k=\'x>y\'>', '</p>']);
  });
  test('a DOCTYPE is skipped and its entities are not expanded', () => {
    expect(events('<!DOCTYPE gpx [<!ENTITY x "boom">]><gpx>&x;</gpx>')).toEqual(['<gpx>', '"&x;"', '</gpx>']);
  });
  test('truncated input ends quietly', () => {
    expect(events('<a><b>text</b><c attr="x')).toEqual(['<a>', '<b>', '"text"', '</b>']);
    expect(events('<a><!-- never closed')).toEqual(['<a>']);
  });
  test('prefixed names arrive without the prefix', () => {
    expect(events('<ns3:hr>101</ns3:hr>')).toEqual(['<hr>', '"101"', '</hr>']);
  });
});

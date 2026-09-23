import { XMLParser } from 'fast-xml-parser';

export type XmlNode = Record<string, unknown>;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseTagValue: false, // keep all text as strings; we parse numbers ourselves
  parseAttributeValue: false,
  trimValues: true, // trims the newline whitespace GP wraps around CDATA
  processEntities: {
    enabled: true,
    maxEntitySize: 64 * 1024,
    maxExpansionDepth: 32,
    maxTotalExpansions: 100_000,
    maxExpandedLength: 16 * 1024 * 1024,
    maxEntityCount: 256,
  },
  maxNestedTags: 256,
});

export function parseXml(xml: string): XmlNode {
  return parser.parse(xml) as XmlNode;
}

// Access a named child element. Returns undefined when the parent isn't an
// element or the child is absent.
export function child(parent: unknown, name: string): unknown {
  if (parent && typeof parent === 'object') return (parent as XmlNode)[name];
  return undefined;
}

// Read an element attribute as a string, or undefined when absent.
export function attr(value: unknown, name: string): string | undefined {
  if (value && typeof value === 'object') {
    const raw = (value as XmlNode)[`@_${name}`];
    return raw === undefined || raw === null ? undefined : String(raw);
  }
  return undefined;
}

// fast-xml-parser yields a single object for one child, an array for many,
// undefined for none. Normalize to an array.
export function toArray<T = XmlNode>(value: unknown): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? (value as T[]) : [value as T];
}

// Trimmed text content of a leaf element (CDATA is merged into the value by
// the parser). '' when absent or empty. For an element that carries both
// attributes and text, the text is under '#text'.
export function text(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  const t = (value as XmlNode)['#text'];
  return t === undefined || t === null ? '' : String(t).trim();
}

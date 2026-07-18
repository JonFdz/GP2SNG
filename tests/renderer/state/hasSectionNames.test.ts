import { describe, expect, test } from 'vitest';
import { hasSectionNames } from '../../../src/renderer/src/state/hasSectionNames';
import type { GpMasterBar } from '../../../src/shared/types/index';

function bar(section: string | null): GpMasterBar {
  return {
    timeSignature: { numerator: 4, denominator: 4 },
    section,
    repeatStart: false,
    repeatEnd: false,
    repeatCount: 0,
    alternateEndings: [],
    hasDirections: false,
  };
}

describe('hasSectionNames', () => {
  test('returns true when a bar has a named section', () => {
    expect(hasSectionNames([bar(null), bar('Chorus'), bar(null)])).toBe(true);
  });

  test('returns false when every bar has a null section', () => {
    expect(hasSectionNames([bar(null), bar(null)])).toBe(false);
  });

  test('treats an empty-string section as no section (matches the converter)', () => {
    expect(hasSectionNames([bar(''), bar(null)])).toBe(false);
  });

  test('returns false for an empty master-bar list', () => {
    expect(hasSectionNames([])).toBe(false);
  });
});

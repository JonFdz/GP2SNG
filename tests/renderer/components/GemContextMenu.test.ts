import { Children, createElement, isValidElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  GemContextMenu,
  GemMenuEditor,
  selectDynamic,
  selectLane,
} from '../../../src/renderer/src/components/GemContextMenu';
import type { YargNote } from '../../../src/shared/types/index';

function render(note: YargNote): string {
  return renderToStaticMarkup(
    createElement(GemContextMenu, {
      note,
      x: 10,
      y: 20,
      onEdit: () => {},
      onDelete: () => {},
      onClose: () => {},
    }),
  );
}

function findButton(node: ReactNode, label: string): { onClick: () => void } {
  if (!isValidElement(node)) throw new Error(`Button ${label} not found.`);
  const props = node.props as {
    'aria-label'?: string;
    children?: ReactNode;
    onClick?: () => void;
  };
  if (node.type === 'button' && props['aria-label'] === label && props.onClick !== undefined) {
    return { onClick: props.onClick };
  }
  for (const child of Children.toArray(props.children)) {
    try {
      return findButton(child, label);
    } catch {
      // Continue through the remaining children.
    }
  }
  throw new Error(`Button ${label} not found.`);
}

describe('GemContextMenu', () => {
  it('offers only individual editing and represents the selected lane and dynamic', () => {
    const html = render({ tick: 0, midi: 42, note: 'blueCymbal', dynamic: 'ghost' });
    expect(html).not.toContain('All notes on MIDI');
    expect(html).not.toContain('type="radio"');
    expect(html).toMatch(/aria-label="Blue cymbal" aria-pressed="true"/);
    expect(html).toMatch(/aria-label="Ghost" aria-pressed="true"/);
  });

  it('keeps all dynamic controls visible but disables Ghost and Accent for orange', () => {
    const html = render({ tick: 0, midi: 36, note: 'orange', dynamic: 'neutral' });
    expect(html).toMatch(/aria-label="Normal" aria-pressed="true"/);
    expect(html).toMatch(/aria-label="Ghost"[^>]*disabled=""/);
    expect(html).toMatch(/aria-label="Accent"[^>]*disabled=""/);
  });

  it.each([
    ['Blue tom', 'blueTom', 'neutral'],
    ['Ghost', 'red', 'ghost'],
  ] as const)('keeps the menu open after selecting %s', (label, note, dynamic) => {
    const onEdit = vi.fn();
    const onClose = vi.fn();
    const editor = GemMenuEditor({
      note: { tick: 0, midi: 38, note: 'red', dynamic: 'neutral' },
      onEdit,
      onDelete: vi.fn(),
      onClose,
    });

    findButton(editor, label).onClick();

    expect(onEdit).toHaveBeenCalledWith(note, dynamic);
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('GemContextMenu selection state', () => {
  it.each(['ghost', 'accent'] as const)('%s -> orange becomes neutral', (dynamic) => {
    expect(selectLane({ note: 'red', dynamic }, 'orange')).toEqual({
      note: 'orange',
      dynamic: 'neutral',
    });
  });

  it('orange -> another lane remains neutral', () => {
    expect(selectLane({ note: 'orange', dynamic: 'neutral' }, 'greenCymbal')).toEqual({
      note: 'greenCymbal',
      dynamic: 'neutral',
    });
  });

  it('changing a non-orange lane preserves the selected dynamic', () => {
    expect(selectLane({ note: 'red', dynamic: 'ghost' }, 'blueTom')).toEqual({
      note: 'blueTom',
      dynamic: 'ghost',
    });
  });

  it('does not allow ghost or accent selection for orange', () => {
    const orange = { note: 'orange' as const, dynamic: 'neutral' as const };
    expect(selectDynamic(orange, 'ghost')).toBeNull();
    expect(selectDynamic(orange, 'accent')).toBeNull();
    expect(selectDynamic(orange, 'neutral')).toEqual(orange);
  });

  it('changing a dynamic preserves the selected lane', () => {
    expect(selectDynamic({ note: 'yellowCymbal', dynamic: 'neutral' }, 'accent')).toEqual({
      note: 'yellowCymbal',
      dynamic: 'accent',
    });
  });
});

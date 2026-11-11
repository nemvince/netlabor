/** Node symbols: strict SVG sanitization plus built-in read-only protection. */

import { AppError, type SymbolRow } from '@netlabor/contract';
import { newId } from '@netlabor/shared';
import type { SQL } from 'bun';

interface SymbolRecord {
  id: string;
  name: string;
  svg: string;
  theme: string | null;
  builtin: boolean;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const XLINK_NS = 'http://www.w3.org/1999/xlink';
const MAX_SVG_BYTES = 512 * 1024;
const MAX_ELEMENTS = 5000;

/** Elements the sanitizer permits. Anything else is rejected, not rewritten. */
const ALLOWED_ELEMENTS: Record<string, true> = {
  svg: true,
  g: true,
  path: true,
  rect: true,
  circle: true,
  ellipse: true,
  line: true,
  polyline: true,
  polygon: true,
  text: true,
  image: true,
};

/** Presentation/geometry attributes; event handlers and links are separate. */
const ALLOWED_ATTRIBUTES: Record<string, true> = {
  id: true,
  class: true,
  style: true,
  transform: true,
  fill: true,
  'fill-opacity': true,
  'fill-rule': true,
  stroke: true,
  'stroke-width': true,
  'stroke-opacity': true,
  'stroke-linecap': true,
  'stroke-linejoin': true,
  'stroke-dasharray': true,
  'stroke-dashoffset': true,
  'stroke-miterlimit': true,
  opacity: true,
  display: true,
  visibility: true,
  'clip-rule': true,
  'clip-path': true,
  color: true,
  'vector-effect': true,
  'font-family': true,
  'font-size': true,
  'font-weight': true,
  'font-style': true,
  'text-anchor': true,
  'dominant-baseline': true,
  'letter-spacing': true,
  'word-spacing': true,
  viewBox: true,
  width: true,
  height: true,
  x: true,
  y: true,
  x1: true,
  y1: true,
  x2: true,
  y2: true,
  cx: true,
  cy: true,
  r: true,
  rx: true,
  ry: true,
  d: true,
  points: true,
  href: true,
  'xlink:href': true,
  preserveAspectRatio: true,
  xmlns: true,
  'xmlns:xlink': true,
  version: true,
  role: true,
  'aria-label': true,
  'aria-hidden': true,
  'xml:space': true,
  pathLength: true,
  textLength: true,
  lengthAdjust: true,
};

function bad(message: string, details?: unknown): AppError {
  return new AppError('BAD_REQUEST', message, { details });
}

function stripXmlDeclaration(source: string): string {
  if (!source.startsWith('<?xml')) return source;
  const end = source.indexOf('?>');
  if (end === -1) throw bad('SVG XML declaration is not terminated');
  const declaration = source.slice(5, end);
  if (/stylesheet|\bhref\b/i.test(declaration)) {
    throw bad('SVG XML stylesheet processing instructions are not allowed');
  }
  return source.slice(end + 2).trimStart();
}

function assertAttribute(element: string, name: string, value: string): void {
  const lowerName = name.toLowerCase();
  if (lowerName.startsWith('on')) {
    throw bad(`SVG event attribute "${name}" is not allowed`, { element, attribute: name });
  }
  if (ALLOWED_ATTRIBUTES[name] !== true) {
    throw bad(`SVG attribute "${name}" is not allowed`, { element, attribute: name });
  }
  if (value.length > 64 * 1024) {
    throw bad(`SVG attribute "${name}" is too long`, { element, attribute: name });
  }

  if (name === 'xmlns') {
    if (value !== SVG_NS) throw bad('SVG xmlns must be the SVG namespace', { value });
    return;
  }
  if (name === 'xmlns:xlink') {
    if (value !== XLINK_NS) throw bad('SVG xlink namespace is not allowed', { value });
    return;
  }
  if (name === 'href' || name === 'xlink:href') {
    if (element !== 'image') {
      throw bad(`SVG attribute "${name}" is only allowed on <image>`, { element, attribute: name });
    }
    if (!value.toLowerCase().startsWith('data:image/')) {
      throw bad('SVG <image> href must be an inline data:image URL', { value: value.slice(0, 64) });
    }
    return;
  }
  if (name === 'style') {
    if (
      /url\s*\(|expression\s*\(|@import|javascript:|vbscript:|behavior\s*:|-moz-binding/i.test(
        value,
      )
    ) {
      throw bad('SVG style attribute contains a disallowed construct', { element });
    }
    return;
  }

  const lower = value.toLowerCase();
  if (lower.includes('javascript:') || lower.includes('vbscript:')) {
    throw bad(`SVG attribute "${name}" contains a script URL`, { element, attribute: name });
  }
  if (lower.includes('data:')) {
    throw bad(`SVG attribute "${name}" contains an inline data URL`, { element, attribute: name });
  }
  if (/(https?:)?\/\//i.test(value)) {
    throw bad(`SVG attribute "${name}" contains an external URL`, { element, attribute: name });
  }
  if (lower.includes('url(')) {
    const matches = value.match(/url\s*\([^)]*\)/gi) ?? [];
    for (const match of matches) {
      const target = match.replace(/^url\s*\(\s*['"]?/i, '').replace(/['"]?\s*\)$/, '');
      if (!target.startsWith('#')) {
        throw bad(`SVG attribute "${name}" references an external resource`, {
          element,
          attribute: name,
          target,
        });
      }
    }
    const remainder = value.replace(/url\s*\([^)]*\)/gi, '');
    if (remainder.toLowerCase().includes('url(')) {
      throw bad(`SVG attribute "${name}" has a malformed url() reference`, {
        element,
        attribute: name,
      });
    }
  }
}

/**
 * Validate an uploaded SVG against the allowlist. Returns the original markup
 * (minus an XML declaration) or throws `BAD_REQUEST` naming the construct.
 */
export function sanitizeSvg(input: string): string {
  let source = input.replace(/^\uFEFF/, '').trim();
  if (source.length === 0) throw bad('SVG is empty');
  if (Buffer.byteLength(source, 'utf8') > MAX_SVG_BYTES) {
    throw bad('SVG exceeds the 512 KiB limit');
  }
  source = stripXmlDeclaration(source);
  if (source.length === 0) throw bad('SVG is empty');

  const doctype = source.indexOf('<!');
  if (doctype !== -1) {
    throw bad('SVG doctype, entity, and CDATA constructs are not allowed', {
      construct: source.slice(doctype, doctype + 16),
    });
  }

  const stack: string[] = [];
  let rootSeen = false;
  let elements = 0;
  let index = 0;

  while (index < source.length) {
    const lt = source.indexOf('<', index);
    if (lt === -1) {
      const text = source.slice(index);
      if (stack.length === 0 && text.trim() !== '') {
        throw bad('SVG has text outside its root element');
      }
      if (text.includes(']]>')) throw bad('SVG text contains a CDATA terminator');
      break;
    }
    if (lt > index && stack.length === 0) {
      const text = source.slice(index, lt);
      if (text.trim() !== '') throw bad('SVG has text outside its root element');
    }

    if (source.startsWith('</', lt)) {
      const gt = source.indexOf('>', lt);
      if (gt === -1) throw bad('SVG closing tag is not terminated');
      const name = source.slice(lt + 2, gt).trim();
      if (ALLOWED_ELEMENTS[name] !== true) {
        throw bad(`SVG element <${name}> is not allowed`, { element: name });
      }
      const expected = stack.pop();
      if (expected !== name) {
        throw bad('SVG tags are not balanced', { element: name, expected: expected ?? null });
      }
      index = gt + 1;
      continue;
    }

    // Opening tag: find its end while respecting quoted attribute values.
    let cursor = lt + 1;
    let quote: string | null = null;
    while (cursor < source.length) {
      const char = source.charAt(cursor);
      if (quote) {
        if (char === quote) quote = null;
      } else if (char === '"' || char === "'") {
        quote = char;
      } else if (char === '>') {
        break;
      }
      cursor++;
    }
    if (cursor >= source.length) throw bad('SVG tag is not terminated');

    let body = source.slice(lt + 1, cursor);
    const selfClosing = body.endsWith('/');
    if (selfClosing) body = body.slice(0, -1).trimEnd();

    const nameMatch = /^([A-Za-z][A-Za-z0-9._-]*)([\s\S]*)$/.exec(body);
    if (!nameMatch) throw bad('SVG tag has an invalid name', { tag: body.slice(0, 32) });
    const name = nameMatch[1] as string;
    const rest = nameMatch[2] ?? '';
    elements++;
    if (elements > MAX_ELEMENTS) throw bad('SVG has too many elements');

    if (ALLOWED_ELEMENTS[name] !== true) {
      throw bad(`SVG element <${name}> is not allowed`, { element: name });
    }
    if (stack.length === 0) {
      if (rootSeen) throw bad('SVG has multiple root elements', { element: name });
      rootSeen = true;
      if (name !== 'svg') throw bad('SVG root element must be <svg>', { element: name });
    }

    const attribute = /\s*([A-Za-z_][A-Za-z0-9_.:-]*)\s*=\s*("([^"]*)"|'([^']*)')\s*/y;
    let position = 0;
    while (position < rest.length) {
      attribute.lastIndex = position;
      const match = attribute.exec(rest);
      if (!match) {
        throw bad('SVG attribute is malformed', {
          element: name,
          near: rest.slice(position, position + 32),
        });
      }
      position = attribute.lastIndex;
      const attributeName = match[1] as string;
      const value = match[3] ?? match[4] ?? '';
      assertAttribute(name, attributeName, value);
    }
    if (rest.slice(position).trim() !== '') {
      throw bad('SVG attribute is malformed', {
        element: name,
        near: rest.slice(position, position + 32),
      });
    }

    if (!selfClosing) stack.push(name);
    index = cursor + 1;
  }

  if (!rootSeen) throw bad('SVG root element is missing');
  if (stack.length > 0) {
    throw bad('SVG tags are not balanced', { open: stack[stack.length - 1] });
  }
  return source;
}

function toSymbolRow(record: SymbolRecord): SymbolRow {
  return {
    id: record.id,
    name: record.name,
    svg: record.svg,
    theme: record.theme,
    builtin: record.builtin,
  };
}

export async function listSymbols(db: SQL): Promise<SymbolRow[]> {
  const rows = await db.unsafe<SymbolRecord[]>(
    'SELECT id, name, svg, theme, builtin FROM symbols ORDER BY builtin DESC, name ASC',
  );
  return rows.map(toSymbolRow);
}

export async function uploadSymbol(
  db: SQL,
  input: { name: string; svg: string },
): Promise<SymbolRow> {
  const svg = sanitizeSvg(input.svg);
  const duplicate = await db.unsafe<{ id: string }[]>('SELECT id FROM symbols WHERE name = $1', [
    input.name,
  ]);
  if (duplicate[0]) throw new AppError('CONFLICT', `a symbol named ${input.name} already exists`);
  const id = newId();
  const rows = await db.unsafe<SymbolRecord[]>(
    `INSERT INTO symbols (id, name, svg, theme, builtin) VALUES ($1, $2, $3, NULL, false)
     RETURNING id, name, svg, theme, builtin`,
    [id, input.name, svg],
  );
  const record = rows[0];
  if (!record) throw new AppError('INTERNAL', 'symbol insert did not return a row');
  return toSymbolRow(record);
}

export async function deleteSymbol(db: SQL, id: string): Promise<void> {
  const rows = await db.unsafe<SymbolRecord[]>(
    'SELECT id, name, svg, theme, builtin FROM symbols WHERE id = $1',
    [id],
  );
  const record = rows[0];
  if (!record) throw new AppError('NOT_FOUND', 'symbol not found');
  if (record.builtin) throw new AppError('CONFLICT', 'built-in symbols cannot be deleted');
  await db.unsafe('DELETE FROM symbols WHERE id = $1', [id]);
}

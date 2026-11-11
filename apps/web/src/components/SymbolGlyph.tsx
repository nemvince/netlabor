import type { CSSProperties } from 'react';

/**
 * Inline SVG symbol. The server sanitizes symbols before storage; this guard is
 * defence in depth so a bad row can never inject script into the document.
 * Inline (not <img>) so `currentColor` follows the UI theme.
 */
export function SymbolGlyph({
  svg,
  className,
  style,
  title,
}: {
  svg: string | null | undefined;
  className?: string;
  style?: CSSProperties;
  title?: string;
}) {
  if (!svg || !/^<svg[\s>]/i.test(svg.trim())) {
    return (
      <span
        aria-hidden
        className={className}
        style={{ display: 'inline-block', border: '1px solid var(--color-rule-strong)', ...style }}
      />
    );
  }
  const safe = svg
    .replace(/<script[\s>][\s\S]*?<\/script>/gi, '')
    .replace(/<foreignObject[\s>][\s\S]*?<\/foreignObject>/gi, '')
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/\s(href|xlink:href)\s*=\s*"(?!#)[^"]*"/gi, '');
  if (title) {
    return (
      <span
        className={className ? `nb-glyph ${className}` : 'nb-glyph'}
        style={style}
        title={title}
        role="img"
        aria-label={title}
        // biome-ignore lint/security/noDangerouslySetInnerHtml: symbols are sanitized on write and again above.
        dangerouslySetInnerHTML={{ __html: safe }}
      />
    );
  }
  return (
    <span
      className={className ? `nb-glyph ${className}` : 'nb-glyph'}
      style={style}
      aria-hidden
      // biome-ignore lint/security/noDangerouslySetInnerHtml: symbols are sanitized on write and again above.
      dangerouslySetInnerHTML={{ __html: safe }}
    />
  );
}

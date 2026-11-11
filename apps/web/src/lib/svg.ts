/** Builds a data URL from a sanitized SVG string for `<img>` rendering. */

export function svgDataUrl(svg: string): string {
  const bytes = new TextEncoder().encode(svg);
  let binary = '';
  const step = 0x8000;
  for (let index = 0; index < bytes.length; index += step) {
    binary += String.fromCharCode(...bytes.subarray(index, index + step));
  }
  return `data:image/svg+xml;base64,${btoa(binary)}`;
}

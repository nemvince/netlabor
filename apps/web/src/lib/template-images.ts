import type { ImageRow, TemplateRow } from '@netlabor/contract';

type RequiredImage = TemplateRow['requiredImages'][number];

/** Glob-ish match for template `filenamePattern` values (`*` and `?`). */
export function matchesFilename(filename: string, pattern: string): boolean {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  const expression = escaped.replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${expression}$`).test(filename);
}

function imageSatisfies(image: ImageRow, required: RequiredImage): boolean {
  if (image.kind !== required.kind) return false;
  return (
    (required.sha256 !== undefined && image.sha256 === required.sha256) ||
    image.name === required.name ||
    matchesFilename(image.name, required.filenamePattern) ||
    matchesFilename(image.filename, required.filenamePattern)
  );
}

export interface RequiredImageState {
  required: RequiredImage;
  present: boolean;
}

/** One present/missing flag per requirement, for coverage strips and tables. */
export function requiredImageStates(
  template: TemplateRow,
  images: ImageRow[] | undefined,
): RequiredImageState[] {
  return template.requiredImages.map((required) => ({
    required,
    present: images?.some((image) => imageSatisfies(image, required)) ?? false,
  }));
}

export function missingRequiredImages(template: TemplateRow, images: ImageRow[]): string[] {
  return template.requiredImages
    .filter((required) => !images.some((image) => imageSatisfies(image, required)))
    .map((required) => required.name);
}

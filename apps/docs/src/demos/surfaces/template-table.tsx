import { Badge } from '@web/components/badge.tsx';
import { SymbolGlyph } from '@web/components/symbol-glyph.tsx';
import { Table, TBody, Td, THead, Th, Tr } from '@web/components/table.tsx';
import { requiredImageStates } from '@web/lib/template-images.ts';
import { images, symbols, templates } from '../fixtures/workspace.ts';

export interface TemplateTableProps {
  /** Fixture template names to list; defaults to every fixture row. */
  templateNames?: string[];
}

/**
 * The template library rows with the same coverage logic the app uses:
 * `requiredImageStates` compares each requirement against the library images,
 * so a template shows present and missing badges from real rows.
 */
export default function TemplateTable({ templateNames }: TemplateTableProps) {
  const wanted = templateNames ? new Set(templateNames) : null;
  const rows = templates.filter((template) => !wanted || wanted.has(template.name));

  return (
    <Table label="Device templates with image coverage">
      <THead>
        <Th>Template</Th>
        <Th>Emulator</Th>
        <Th>Category</Th>
        <Th>Name format</Th>
        <Th>Image coverage</Th>
      </THead>
      <TBody>
        {rows.map((template) => {
          const coverage = requiredImageStates(template, images);
          return (
            <Tr key={template.id}>
              <Td>
                <span className="flex items-center gap-2">
                  <SymbolGlyph svg={symbols.get(template.symbol) ?? null} className="size-4" />
                  <span>{template.name}</span>
                  {template.builtin ? <Badge tone="copper">builtin</Badge> : null}
                </span>
              </Td>
              <Td mono>{template.nodeType}</Td>
              <Td>{template.category}</Td>
              <Td mono>{template.defaultNameFormat}</Td>
              <Td>
                <span className="flex flex-wrap gap-1">
                  {coverage.length === 0 ? <Badge tone="neutral">none required</Badge> : null}
                  {coverage.map((state) => (
                    <Badge
                      key={state.required.name}
                      tone={state.present ? 'up' : 'warn'}
                      title={
                        state.present
                          ? `${state.required.name} has a present replica`
                          : `${state.required.name} is missing on the target compute`
                      }
                    >
                      {state.present ? state.required.name : `missing: ${state.required.name}`}
                    </Badge>
                  ))}
                </span>
              </Td>
            </Tr>
          );
        })}
      </TBody>
    </Table>
  );
}

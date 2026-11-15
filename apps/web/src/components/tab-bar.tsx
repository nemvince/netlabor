import { type Icon  } from '@phosphor-icons/react';
import { Tabs, TabsList, TabsTrigger } from '@netlabor/ui/components/tabs';

export interface TabItem<T extends string> {
  id: T;
  label: string;
  icon?: Icon;
}

/**
 * Underline tab strip shared by the library and the network tools. Built on
 * Radix Tabs: arrow/Home/End roving focus and activation come from the
 * primitive, so the bar renders no keyboard handling of its own.
 */
export function TabBar<T extends string>({
  label,
  value,
  items,
  onChange,
}: {
  label: string;
  value: T;
  items: readonly TabItem<T>[];
  onChange: (id: T) => void;
}) {
  return (
    <Tabs
      value={value}
      onValueChange={(next: string) => onChange(next as T)}
      className="flex-col"
    >
      <TabsList
        aria-label={label}
        variant="line"
        className="h-auto w-full flex-wrap justify-start gap-1 rounded-none border-b border-border"
      >
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <TabsTrigger
              key={item.id}
              value={item.id}
              className="h-auto gap-1 rounded-none px-3 py-1.5 text-[12px] after:bg-primary data-[state=inactive]:text-muted-foreground"
            >
              {Icon ? <Icon size={13} aria-hidden /> : null}
              {item.label}
            </TabsTrigger>
          );
        })}
      </TabsList>
    </Tabs>
  );
}

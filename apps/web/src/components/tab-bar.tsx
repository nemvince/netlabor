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
        className="h-auto w-full flex-wrap justify-start gap-1 rounded-none border-b border-border p-0"
      >
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <TabsTrigger
              key={item.id}
              value={item.id}
              className="h-auto flex-none gap-1 rounded-none border-0 bg-transparent px-3 py-1.5 text-[12px] font-medium text-muted-foreground after:bg-primary hover:text-foreground data-active:border-transparent data-active:bg-transparent data-active:text-foreground data-active:after:opacity-100 dark:data-active:bg-transparent"
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

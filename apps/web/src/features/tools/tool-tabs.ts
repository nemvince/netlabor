/** Network tools shared by the standalone page, the project menu, and dock panes. */

export type ToolTab = 'splitter' | 'vlsm' | 'calculator' | 'overlap' | 'networks';

export const TOOL_TABS: { id: ToolTab; label: string }[] = [
  { id: 'splitter', label: 'Subnet splitter' },
  { id: 'vlsm', label: 'VLSM planner' },
  { id: 'calculator', label: 'IP calculator' },
  { id: 'overlap', label: 'Overlap check' },
  { id: 'networks', label: 'Networks' },
];

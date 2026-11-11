import type {
  DrawingCreateInput as DrawingCreateInputSchema,
  LinkCreateInput as LinkCreateInputSchema,
  NodeUpdateInput as NodeUpdateInputSchema,
} from '@netlabor/contract';
import type { z } from 'zod';

/**
 * Input types the contract exports as schemas only. Deriving them here keeps
 * the UI aligned with the same Zod objects the controller validates.
 */
export type NodeUpdateInput = Omit<z.infer<typeof NodeUpdateInputSchema>, 'id'>;
export type LinkCreateInput = z.infer<typeof LinkCreateInputSchema>;
export type DrawingCreateInput = z.infer<typeof DrawingCreateInputSchema>;

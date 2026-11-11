/** Encrypted operator secrets (IOU iourc, vendor credentials). */

import type { SecretRow } from '@netlabor/contract';
import { AppError } from '@netlabor/contract';
import { encryptSecret, newId } from '@netlabor/shared';
import type { SQL } from 'bun';
import type { AppDeps } from '../implementer.ts';

export async function listSecrets(db: SQL): Promise<SecretRow[]> {
  const rows = await db.unsafe<{ id: string; name: string; created_at: Date }[]>(
    "SELECT id, name, created_at FROM secrets WHERE name NOT LIKE 'compute-token:%' ORDER BY name ASC",
  );
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    createdAt: row.created_at.toISOString(),
  }));
}

export async function createSecret(
  deps: AppDeps,
  input: { name: string; value: string },
): Promise<SecretRow> {
  const name = input.name.trim();
  if (name.startsWith('compute-token:')) {
    throw new AppError('BAD_REQUEST', 'that secret name prefix is reserved');
  }
  const duplicate = await deps.db.unsafe<{ id: string }[]>(
    'SELECT id FROM secrets WHERE name = $1',
    [name],
  );
  if (duplicate[0]) throw new AppError('CONFLICT', 'a secret with that name already exists');
  const encrypted = encryptSecret(input.value, deps.config.secretKey);
  const id = newId();
  const rows = await deps.db.unsafe<{ created_at: Date }[]>(
    `INSERT INTO secrets (id, name, ciphertext, nonce)
     VALUES ($1, $2, $3, $4) RETURNING created_at`,
    [id, name, encrypted.ciphertext, encrypted.nonce],
  );
  return { id, name, createdAt: (rows[0]?.created_at ?? new Date()).toISOString() };
}

export async function deleteSecret(db: SQL, id: string): Promise<void> {
  const rows = await db.unsafe<{ id: string }[]>(
    `DELETE FROM secrets WHERE id = $1 AND name NOT LIKE 'compute-token:%' RETURNING id`,
    [id],
  );
  if (!rows[0]) throw new AppError('NOT_FOUND', 'secret not found');
}

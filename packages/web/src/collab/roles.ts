import type { Role } from '../api/client';
export type { Role };

export const roleCan = {
  editBody: (r: Role): boolean => r === 'owner' || r === 'editor',
  comment: (r: Role): boolean => r !== 'viewer',
  manage: (r: Role): boolean => r === 'owner',
};

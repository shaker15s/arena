import type { Role } from './types';

export type AccessPatch = {
  role?: Role;
  status?: 'active' | 'disabled';
  branchId?: string | null;
  clearBranch?: boolean;
};

export type AccessPayload = {
  p_profile_id: string;
  p_role: Role | null;
  p_status: 'active' | 'disabled' | null;
  p_branch_id: string | null;
  p_clear_branch: boolean;
  [key: string]: unknown;
};

/** 5 مفاتيح دائمًا — p_clear_branch صريح (يلغي غموض أي overload قادمة). */
export function buildAccessPayload(profileId: string, patch: AccessPatch): AccessPayload {
  return {
    p_profile_id: profileId,
    p_role: patch.role ?? null,
    p_status: patch.status ?? null,
    p_branch_id: patch.branchId !== undefined ? patch.branchId : null,
    p_clear_branch: patch.clearBranch ?? false,
  };
}

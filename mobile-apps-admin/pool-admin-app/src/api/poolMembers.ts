import { apiRequest } from './client';

export interface PoolMember {
  id: string;
  first_name: string;
  last_name: string;
  entry_type_id: number | string;
  entry_type_name: string;
  status?: string;
  is_active?: number | boolean;
  rfid_tag?: string | null;
  device_platform?: 'ios' | 'android' | null;
  is_child_under_16?: boolean;
  street_address?: string | null;
  household_owner_name?: string | null;
  notes?: string | null;
  source?: string;
  last_check_in?: string | null;
}

export interface PoolCredential {
  id: string;
  pool_member_id: string;
  credential_type: 'rfid' | 'phone' | 'wallet';
  credential_value?: string | null;
  device_platform?: 'ios' | 'android' | null;
  device_label?: string | null;
  status: 'active' | 'revoked' | 'pending';
  created_at?: string;
}

export async function fetchPoolMembers(): Promise<PoolMember[]> {
  return apiRequest<PoolMember[]>('/api/admin/pool/members');
}

export async function fetchMemberCredentials(memberId: string): Promise<PoolCredential[]> {
  return apiRequest<PoolCredential[]>(
    `/api/admin/pool/members/${encodeURIComponent(memberId)}/credentials`,
  );
}

export async function revokeMemberCredential(
  memberId: string,
  credId: string,
): Promise<void> {
  await apiRequest(
    `/api/admin/pool/members/${encodeURIComponent(memberId)}/credentials/${encodeURIComponent(credId)}/revoke`,
    { method: 'POST' },
  );
}

export interface UpdateMemberInput {
  first_name?: string;
  last_name?: string;
  entry_type_id?: number | string;
  notes?: string | null;
  is_active?: boolean;
  status?: string;
}

export async function updateMember(
  memberId: string,
  input: UpdateMemberInput,
): Promise<void> {
  await apiRequest(`/api/admin/pool/members/${encodeURIComponent(memberId)}`, {
    method: 'PUT',
    body: JSON.stringify(input),
  });
}

export async function deleteMember(memberId: string): Promise<void> {
  await apiRequest(`/api/admin/pool/members/${encodeURIComponent(memberId)}`, {
    method: 'DELETE',
  });
}

export interface CreateMemberInput {
  first_name: string;
  last_name: string;
  entry_type_id: number | string;
  notes?: string;
  rfid_tag?: string;
}

export async function createMember(input: CreateMemberInput): Promise<{ id: string }> {
  return apiRequest<{ id: string }>('/api/admin/pool/members', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

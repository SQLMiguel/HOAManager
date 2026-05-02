import { apiRequest } from './client';

export interface CheckinEntry {
  id: string | number;
  pool_member_id: string;
  first_name: string;
  last_name: string;
  entry_type_name: string;
  entry_type_id: number | string;
  check_in_time: string;
  status?: 'allowed' | 'denied' | string;
  reason?: string | null;
  credential_type?: string | null;
  credential_value?: string | null;
}

export async function fetchCheckins(limit = 100): Promise<CheckinEntry[]> {
  return apiRequest<CheckinEntry[]>(
    `/api/admin/pool/checkins?limit=${encodeURIComponent(String(limit))}`,
  );
}

export interface GateSnapshot {
  online?: boolean;
  last_sync?: string | null;
  pending_changes?: number;
  members_total?: number;
  credentials_total?: number;
  [key: string]: unknown;
}

export async function fetchGateSnapshot(): Promise<GateSnapshot> {
  return apiRequest<GateSnapshot>('/api/admin/gate/snapshot');
}

export async function triggerGateSync(): Promise<{ success?: boolean; [key: string]: unknown }> {
  return apiRequest('/api/admin/gate/sync', { method: 'POST' });
}

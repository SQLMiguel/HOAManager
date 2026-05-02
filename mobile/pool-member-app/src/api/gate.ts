import { apiRequest } from './client';

/**
 * Gate-open API.
 *
 * NOTE: The dedicated mobile gate-open endpoint is part of the backend
 * additions described in `docs/mobile-apps/pool-member-app-TRD.md`. Until
 * that endpoint ships, this client posts to `/api/mobile/member/gate/open`
 * and the UI surfaces a clear error if the server returns 404 / 501.
 */

export interface GateOpenRequest {
  latitude?: number;
  longitude?: number;
  device_id?: string;
}

export interface GateOpenResponse {
  allowed: boolean;
  reason?: string;
  member_name?: string;
  timestamp?: string;
  transaction_id?: string;
}

export async function openGate(input: GateOpenRequest = {}) {
  return apiRequest<GateOpenResponse>('/api/mobile/member/gate/open', {
    method: 'POST',
    body: input,
    timeoutMs: 6000,
  });
}

export interface GateHistoryEntry {
  id: string;
  person_name: string;
  status: 'allowed' | 'denied';
  reason?: string;
  check_in_time: string;
}

export async function fetchGateHistory(limit = 25) {
  return apiRequest<GateHistoryEntry[]>(
    `/api/mobile/member/gate/history?limit=${encodeURIComponent(limit)}`,
  );
}

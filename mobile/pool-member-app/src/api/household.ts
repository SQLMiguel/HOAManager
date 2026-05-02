import { apiRequest } from './client';

export interface DirectoryAdult {
  id: string;
  name: string;
  phone?: string | null;
  email?: string | null;
  is_visible?: number;
}

export interface DirectoryChild {
  id: string;
  first_name: string;
  is_16_plus?: number;
  phone?: string | null;
  email?: string | null;
}

export interface DirectoryProfile {
  user: {
    first_name: string;
    last_name: string;
    email: string;
    address: string;
  };
  profile: Record<string, unknown> | null;
  adults: DirectoryAdult[];
  children: DirectoryChild[];
}

export interface PoolPhone {
  id: string;
  person_type: 'self' | 'adult' | 'child';
  person_id: string | null;
  person_name: string;
  device_platform: 'ios' | 'android';
  device_label: string | null;
  wallet_pass_status: 'pending' | 'sent';
  status: 'active' | 'revoked';
  is_active_guest: boolean;
  pool_member_id: string | null;
  created_at: string;
  updated_at: string;
}

export async function fetchHousehold() {
  return apiRequest<DirectoryProfile>('/api/directory/me');
}

export async function fetchPoolPhones() {
  return apiRequest<{ phones: PoolPhone[] }>('/api/directory/me/pool-phones');
}

export interface RegisterPhoneInput {
  person_type: 'self' | 'adult' | 'child';
  person_id?: string | null;
  device_platform: 'ios' | 'android';
  device_label?: string;
}

export async function registerPoolPhone(input: RegisterPhoneInput) {
  return apiRequest<{ success: true; phone: PoolPhone }>('/api/directory/me/pool-phones', {
    method: 'POST',
    body: input,
  });
}

export async function revokePoolPhone(id: string) {
  return apiRequest<{ success: true }>(`/api/directory/me/pool-phones/${id}`, {
    method: 'DELETE',
  });
}

import { apiRequest } from './client';

export interface MeResponse {
  authenticated: boolean;
  user?: {
    firstName: string;
    lastName: string;
    email: string;
  };
}

export async function loginRequest(email: string, password: string) {
  return apiRequest<{ success: true; user: MeResponse['user'] }>('/api/login', {
    method: 'POST',
    body: { email, password },
  });
}

export async function logoutRequest() {
  return apiRequest<{ success: true }>('/api/logout', { method: 'POST' });
}

export async function fetchMe() {
  return apiRequest<MeResponse>('/api/me');
}

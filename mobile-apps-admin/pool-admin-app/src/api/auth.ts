import { apiRequest, setSessionCookie } from './client';

export interface AdminMe {
  email: string;
  firstName: string;
  lastName: string;
  isAdmin: boolean;
  role?: string;
}

export async function adminLogin(email: string, password: string): Promise<AdminMe> {
  const res = await apiRequest<{ user?: AdminMe }>('/api/admin/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  // Server returns user data; fall back to /api/me if shape differs
  if (res?.user?.isAdmin) return res.user;
  return adminMe();
}

export async function adminMe(): Promise<AdminMe> {
  const res = await apiRequest<AdminMe>('/api/me');
  if (!res.isAdmin) {
    throw new Error('This account does not have admin access.');
  }
  return res;
}

export async function adminLogout(): Promise<void> {
  try {
    await apiRequest('/api/logout', { method: 'POST' });
  } finally {
    await setSessionCookie(null);
  }
}

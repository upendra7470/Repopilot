const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

interface RequestOptions {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
}

interface ApiErrorResponse {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

class ApiClient {
  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  private async request<T>(path: string, options?: RequestOptions): Promise<T> {
    const { method = 'GET', body, headers = {} } = options || {};

    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const errorData = (await response.json().catch(() => null)) as ApiErrorResponse | null;
      throw new ApiError(
        errorData?.error?.code || 'UNKNOWN_ERROR',
        errorData?.error?.message || `Request failed with status ${response.status}`,
        response.status,
        errorData?.error?.details
      );
    }

    return response.json() as Promise<T>;
  }

  async getHealth() {
    return this.request<{ status: string; timestamp: string; uptime: number }>('/health');
  }

  async getHealthDb() {
    return this.request<{ status: string; database: string }>('/health/db');
  }

  async getUsers() {
    return this.request<{ data: Array<{ id: string; login: string; name: string | null }> }>('/api/users');
  }

  async getUser(id: string) {
    return this.request<{ data: { id: string; login: string; name: string | null } }>(`/api/users/${id}`);
  }

  async createUser(data: { login: string; name?: string; email?: string }) {
    return this.request<{ data: { id: string; login: string } }>('/api/users', {
      method: 'POST',
      body: data,
    });
  }

  async getRepositories() {
    return this.request<{ data: Array<{ id: string; name: string; fullName: string }> }>('/api/repositories');
  }

  async getRepository(id: string) {
    return this.request<{ data: { id: string; name: string; fullName: string } }>(`/api/repositories/${id}`);
  }

  async createRepository(data: { owner: string; name: string; description?: string }) {
    return this.request<{ data: { id: string; name: string } }>('/api/repositories', {
      method: 'POST',
      body: data,
    });
  }
}

export class ApiError extends Error {
  code: string;
  statusCode: number;
  details?: Record<string, unknown>;

  constructor(code: string, message: string, statusCode: number, details?: Record<string, unknown>) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

export const api = new ApiClient(API_BASE_URL);

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { api, ApiError } from '../client';

function jsonResponse(data: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(data),
  } as Response;
}

function errorJsonResponse(code: string, message: string, status: number, details?: Record<string, unknown>) {
  return {
    ok: false,
    status,
    json: () => Promise.resolve({ error: { code, message, details } }),
  } as Response;
}

describe('ApiClient', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('GET request returns data on success', async () => {
    const payload = { status: 'ok', timestamp: '2024-01-01', uptime: 100 };
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse(payload));

    const result = await api.getHealth();

    expect(result).toEqual(payload);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:3001/health',
      expect.objectContaining({ method: 'GET' })
    );
  });

  it('POST request returns data on success', async () => {
    const payload = { data: { id: '1', login: 'testuser' } };
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse(payload));

    const result = await api.createUser({ login: 'testuser', name: 'Test User' });

    expect(result).toEqual(payload);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:3001/api/users',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ login: 'testuser', name: 'Test User' }),
      })
    );
  });

  it('non-2xx response throws ApiError with correct code and message', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      errorJsonResponse('NOT_FOUND', 'User not found', 404)
    );

    await expect(api.getUser('999')).rejects.toThrow(ApiError);

    try {
      await api.getUser('999');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      const apiErr = err as ApiError;
      expect(apiErr.code).toBe('NOT_FOUND');
      expect(apiErr.message).toBe('User not found');
      expect(apiErr.statusCode).toBe(404);
    }
  });

  it('network error throws appropriately', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new TypeError('Failed to fetch'));

    await expect(api.getHealth()).rejects.toThrow('Failed to fetch');
  });

  it('malformed JSON response handles gracefully', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.reject(new SyntaxError('Unexpected token')),
    } as Response);

    await expect(api.getHealth()).rejects.toThrow(ApiError);

    try {
      await api.getHealth();
    } catch (err) {
      const apiErr = err as ApiError;
      expect(apiErr.code).toBe('UNKNOWN_ERROR');
      expect(apiErr.message).toBe('Request failed with status 500');
      expect(apiErr.statusCode).toBe(500);
    }
  });

  it('custom headers are passed through', async () => {
    const payload = { data: [{ id: '1', login: 'a' }] };
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse(payload));

    await api.getRepositories();

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:3001/api/repositories',
      expect.objectContaining({
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
        }),
      })
    );
  });
});

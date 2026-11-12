const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
async function rawRequest(path: string, options: RequestInit = {}, retried = false): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      ...options, credentials: 'include',
      headers: { 'X-Requested-With': 'XMLHttpRequest', ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }), ...options.headers }
    });
  } catch {
    throw new Error(`Unable to reach the API server at ${API_URL}. Start the backend and confirm its MongoDB connection, then try again.`);
  }
  if (response.status === 401 && !retried && path !== '/api/auth/refresh') {
    const refresh = await rawRequest('/api/auth/refresh', { method: 'POST' }, true);
    if (refresh.ok) return rawRequest(path, options, true);
  }
  return response;
}
export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await rawRequest(path, options);
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error?.message ?? `Request failed (${response.status})`);
  }
  if (response.status === 204) return undefined as T;
  return response.json();
}

export async function download(path: string, filename: string): Promise<void> {
  const response = await rawRequest(path);
  if (!response.ok) throw new Error(`Download failed (${response.status})`);
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = filename;
  document.body.appendChild(link); link.click(); link.remove();
  URL.revokeObjectURL(url);
}

import { afterEach, describe, expect, it, vi } from 'vitest';
import { GitHubTransport } from '../src/github/transport';

afterEach(() => vi.useRealTimers());
describe('bounded GitHub transport', () => {
  it('rejects foreign, backslash, credential and fragment URLs before dispatch', async () => {
    const request = vi.fn<typeof fetch>();
    const transport = new GitHubTransport(request);
    for (const path of [
      'https://elsewhere.example/user',
      '//elsewhere.example/user',
      '/\\elsewhere.example',
      '/user#credential',
    ])
      await expect(transport.json(path, 'fictional-secret')).rejects.toThrow('Invalid');
    expect(request).not.toHaveBeenCalled();
  });
  it('never follows supplied links or redirects and never includes cookies', async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response('{}', {
          headers: { link: '<https://elsewhere.example/secret>; rel="next"' },
        }),
      )
      .mockResolvedValueOnce(
        new Response('sensitive error body', {
          status: 302,
          headers: { location: 'https://elsewhere.example' },
        }),
      );
    const transport = new GitHubTransport(request);
    expect(await transport.json('/user', 'fictional-token')).toEqual({ body: {}, hasNext: true });
    await expect(transport.json('/user', 'fictional-token')).rejects.toThrow('(302)');
    expect(request).toHaveBeenCalledTimes(2);
    for (const [url, options] of request.mock.calls) {
      expect(new URL(String(url)).origin).toBe('https://api.github.com');
      expect(options).toMatchObject({ redirect: 'error', credentials: 'omit', method: 'GET' });
    }
  });
  it('bounds chunked decoded bodies, cancels their source, and hides response secrets', async () => {
    let canceled = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new TextEncoder().encode('private-response'));
      },
      cancel() {
        canceled = true;
      },
    });
    const transport = new GitHubTransport(
      vi.fn<typeof fetch>().mockResolvedValue(new Response(body)),
    );
    await expect(transport.json('/user', 'fictional-token', { maxBytes: 20 })).rejects.toThrow(
      'oversized',
    );
    expect(canceled).toBe(true);
    const malformed = new GitHubTransport(
      vi.fn<typeof fetch>().mockResolvedValue(new Response('fictional-private-token')),
    );
    await expect(malformed.json('/user')).rejects.not.toThrow('fictional-private-token');
  });
  it('uses finite backoff for malformed rate headers, and resumes afterward', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response('{}', {
          status: 429,
          headers: { 'retry-after': 'Infinity', 'x-ratelimit-reset': 'NaN' },
        }),
      )
      .mockResolvedValueOnce(new Response('{}'));
    const transport = new GitHubTransport(request);
    await expect(transport.json('/user')).rejects.toMatchObject({ retryAt: Date.now() + 60_000 });
    await expect(transport.json('/user')).rejects.toThrow('rate limited');
    expect(request).toHaveBeenCalledTimes(1);
    vi.setSystemTime(Date.now() + 60_001);
    expect((await transport.json('/user')).body).toEqual({});
  });
  it('can clear anonymous backoff after the connection changes', async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('{}', { status: 429 }))
      .mockResolvedValueOnce(new Response('{}'));
    const transport = new GitHubTransport(request);
    await expect(transport.json('/user')).rejects.toThrow('rate limited');
    transport.resetBackoff();
    await expect(transport.json('/user', 'connected-token')).resolves.toMatchObject({ body: {} });
    expect(request).toHaveBeenCalledTimes(2);
  });
  it('uses authenticated ETags and accepts an unchanged response without reading a body', async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('[]', { headers: { etag: '"pulls-v1"' } }))
      .mockResolvedValueOnce(new Response(null, { status: 304 }));
    const transport = new GitHubTransport(request);

    const first = await transport.json('/repos/example/project/pulls', 'connected-token');
    const unchanged = await transport.json('/repos/example/project/pulls', 'connected-token', {
      etag: first.etag,
    });

    expect(first).toMatchObject({ body: [], etag: '"pulls-v1"' });
    expect(unchanged).toEqual({
      body: undefined,
      etag: '"pulls-v1"',
      hasNext: false,
      notModified: true,
    });
    expect(new Headers(request.mock.calls[1][1]?.headers).get('if-none-match')).toBe('"pulls-v1"');
  });
  it('stops pre-aborted requests and discards a response arriving after cancellation', async () => {
    const abort = new AbortController();
    const request = vi.fn<typeof fetch>().mockImplementation(async () => {
      abort.abort();
      return new Response('{}');
    });
    const transport = new GitHubTransport(request);
    await expect(transport.json('/user', undefined, { signal: abort.signal })).rejects.toThrow();
    await expect(transport.json('/user', undefined, { signal: abort.signal })).rejects.toThrow();
    expect(request).toHaveBeenCalledTimes(1);
  });
  it('does not relay network exceptions that contain credentials', async () => {
    const transport = new GitHubTransport(
      vi.fn<typeof fetch>().mockRejectedValue(new Error('Authorization: secret-value')),
    );
    await expect(transport.json('/user')).rejects.toThrow('could not complete');
    await expect(transport.json('/user')).rejects.not.toThrow('secret-value');
  });
});

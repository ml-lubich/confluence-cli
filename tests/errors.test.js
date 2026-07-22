const { formatApiError, extractApiMessage, EXIT } = require('../lib/errors');

const httpError = (status, data, headers) => ({
  response: { status, data, headers: headers || {} },
  request: {},
});

describe('extractApiMessage', () => {
  test('reads a string body', () => {
    expect(extractApiMessage('boom')).toBe('boom');
  });
  test('reads .message / .error / errors[0].message', () => {
    expect(extractApiMessage({ message: 'a' })).toBe('a');
    expect(extractApiMessage({ error: 'b' })).toBe('b');
    expect(extractApiMessage({ errors: [{ message: 'c' }] })).toBe('c');
  });
  test('returns null for empty', () => {
    expect(extractApiMessage(null)).toBeNull();
    expect(extractApiMessage({})).toBeNull();
  });
});

describe('formatApiError', () => {
  test('401 → auth guidance + AUTH exit code', () => {
    const r = formatApiError(httpError(401, { message: 'no' }));
    expect(r.message).toMatch(/Authentication failed \(401\)/);
    expect(r.message).toMatch(/Confluence said: no/);
    expect(r.hint).toMatch(/confluence init/);
    expect(r.exitCode).toBe(EXIT.AUTH);
  });

  test('403 → permission guidance', () => {
    const r = formatApiError(httpError(403));
    expect(r.message).toMatch(/Permission denied \(403\)/);
    expect(r.hint).toMatch(/read-only|permission/i);
    expect(r.exitCode).toBe(EXIT.PERMISSION);
  });

  test('404 → not found guidance', () => {
    const r = formatApiError(httpError(404));
    expect(r.message).toMatch(/Not found \(404\)/);
    expect(r.exitCode).toBe(EXIT.NOT_FOUND);
  });

  test('409 → conflict guidance', () => {
    expect(formatApiError(httpError(409)).exitCode).toBe(EXIT.CONFLICT);
  });

  test('429 → includes Retry-After when present', () => {
    const r = formatApiError(httpError(429, null, { 'retry-after': '30' }));
    expect(r.hint).toMatch(/30s/);
    expect(r.exitCode).toBe(EXIT.RATE_LIMIT);
  });

  test('500 → server error', () => {
    const r = formatApiError(httpError(503));
    expect(r.message).toMatch(/server error \(503\)/i);
    expect(r.exitCode).toBe(EXIT.SERVER);
  });

  test('no response → network error', () => {
    const r = formatApiError({ request: {}, code: 'ECONNREFUSED', message: 'connect ECONNREFUSED' });
    expect(r.message).toMatch(/Could not reach/);
    expect(r.message).toMatch(/ECONNREFUSED/);
    expect(r.exitCode).toBe(EXIT.NETWORK);
  });

  test('plain Error → generic', () => {
    const r = formatApiError(new Error('weird'));
    expect(r.message).toBe('weird');
    expect(r.exitCode).toBe(EXIT.GENERIC);
  });
});

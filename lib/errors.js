'use strict';

// Central translation of low-level failures (axios errors, network errors) into
// a message a human OR an agent can act on, plus a stable exit code. Keeping the
// mapping here means every command reports failures the same, actionable way.

// Stable, documented exit codes. 1 stays the generic catch-all.
const EXIT = {
  GENERIC: 1,
  AUTH: 3,        // 401 — credentials rejected
  PERMISSION: 4,  // 403 — authenticated but not allowed
  NOT_FOUND: 5,   // 404 — no such content
  CONFLICT: 6,    // 409 — version/state conflict
  RATE_LIMIT: 7,  // 429 — throttled
  SERVER: 8,      // 5xx — Confluence-side error
  NETWORK: 9,     // no response — DNS/connection/TLS
};

/** Pull the human-readable message Confluence puts in an error body, if any. */
function extractApiMessage(data) {
  if (!data) return null;
  if (typeof data === 'string') return data.trim() || null;
  return data.message || data.error || (Array.isArray(data.errors) && data.errors[0]?.message) || null;
}

/**
 * @param {any} error - typically an axios error
 * @returns {{ message: string, hint: string, exitCode: number }}
 */
function formatApiError(error) {
  const status = error?.response?.status;
  const apiMessage = extractApiMessage(error?.response?.data);
  const withApi = (base) => (apiMessage ? `${base} (Confluence said: ${apiMessage})` : base);

  // No HTTP response at all → connectivity/DNS/TLS, not an API error.
  if (error && error.request && !error.response) {
    const code = error.code ? ` [${error.code}]` : '';
    return {
      message: `Could not reach the Confluence server${code}.`,
      hint: 'Check the domain in your config, your network/VPN, and that the host is reachable.',
      exitCode: EXIT.NETWORK,
    };
  }

  switch (status) {
  case 401:
    return {
      message: withApi('Authentication failed (401).'),
      hint: 'Your token/credentials were rejected. Re-run "confluence init" with a fresh API token.',
      exitCode: EXIT.AUTH,
    };
  case 403:
    return {
      message: withApi('Permission denied (403).'),
      hint: 'You are authenticated but lack rights on this space/content. Check space permissions, or that the profile is not read-only.',
      exitCode: EXIT.PERMISSION,
    };
  case 404:
    return {
      message: withApi('Not found (404).'),
      hint: 'No content with that id/space. If you pasted a URL that is fine — verify the id, space key, and that it was not already deleted.',
      exitCode: EXIT.NOT_FOUND,
    };
  case 409:
    return {
      message: withApi('Conflict (409).'),
      hint: 'The content changed under you (version conflict) or a page with that title already exists. Re-read and retry.',
      exitCode: EXIT.CONFLICT,
    };
  case 429: {
    const retryAfter = error?.response?.headers?.['retry-after'];
    return {
      message: withApi('Rate limited (429).'),
      hint: retryAfter
        ? `Confluence asked you to wait ${retryAfter}s. Retry after that, or lower --concurrency.`
        : 'Too many requests. Retry shortly, or lower --concurrency.',
      exitCode: EXIT.RATE_LIMIT,
    };
  }
  default:
    break;
  }

  if (typeof status === 'number' && status >= 500) {
    return {
      message: withApi(`Confluence server error (${status}).`),
      hint: 'This is a problem on the Confluence side. Retry later; if it persists, check Atlassian status.',
      exitCode: EXIT.SERVER,
    };
  }

  if (typeof status === 'number') {
    return {
      message: withApi(`Request failed (${status}).`),
      hint: 'Unexpected HTTP status. Re-run with --json for the raw response body.',
      exitCode: EXIT.GENERIC,
    };
  }

  return {
    message: error?.message || 'Unknown error.',
    hint: 'Re-run the command; if it persists, file an issue with the full output.',
    exitCode: EXIT.GENERIC,
  };
}

module.exports = { formatApiError, extractApiMessage, EXIT };

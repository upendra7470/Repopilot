# Security Policy

## Supported Versions

RepoPilot is under active development. Security fixes apply to the current
`main` branch. There are no LTS releases yet.

## Reporting a Vulnerability

Open a GitHub issue titled `[security]` with:

- what is affected (route, service, or UI surface),
- steps to reproduce against a local checkout,
- what you expected vs. what happened.

Do **not** include real credentials, tokens, or private repository data in
reports. Do not test vulnerabilities against anyone else's deployment.

## Security Model

Authentication and isolation (verified in `server/src`):

- GitHub OAuth with read-only identity scopes; no repository write scopes.
- Signed, HTTP-only session cookies (`SameSite=lax`, `Secure` in production);
  only SHA-256 token hashes are stored server-side.
- Every repository route enforces user→repository ownership and returns a
  privacy-preserving 404 for unknown, malformed, or foreign IDs.
- All intelligence queries, history, and caches are scoped by `repositoryId`.
- API keys are encrypted with AES-256-GCM and never leave the server:
  never in responses, logs, prompts, URLs, or client storage
  (client `localStorage` holds only the UI theme).
- 5xx responses are generic with a `requestId` for log correlation; stacks
  never reach clients.
- Sensitive routes are rate-limited; request/response schemas are validated
  (Fastify + Zod); all database access is parameterized (Drizzle ORM).
- AI provider base URLs are user-supplied and fetched server-side with an
  outbound guard: `http(s)` only, no embedded credentials, no unresolvable
  hosts, and link-local/unspecified targets (including the `169.254.169.254`
  cloud metadata address) are refused. Loopback and LAN addresses are
  intentionally allowed so local providers (Ollama, LM Studio) and
  self-hosted gateways keep working.

## Known Limitations

- `npm audit` reports 4 moderate findings, all the same dev-only esbuild
  issue (GHSA-67mh-4wv8-2f99) via `drizzle-kit`; production dependencies
  report 0 vulnerabilities. The fix requires a breaking `drizzle-kit`
  downgrade and is deferred until upstream resolves it.
- The backend serves JSON only; frontend hosting must provide its own
  transport security (HTTPS) and content-security headers.
- `AUTH_SECRET` must be set to a stable ≥32-character value in production;
  without it, sessions do not survive restarts (by design, with a warning).

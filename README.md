# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some Oxlint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the Oxlint configuration

If you are developing a production application, we recommend enabling type-aware lint rules by installing `oxlint-tsgolint` and editing `.oxlintrc.json`:

```json
{
  "$schema": "./node_modules/oxlint/configuration_schema.json",
  "plugins": ["react", "typescript", "oxc"],
  "options": {
    "typeAware": true
  },
  "rules": {
    "react/rules-of-hooks": "error",
    "react/only-export-components": ["warn", { "allowConstantExport": true }]
  }
}
```

See the [Oxlint rules documentation](https://oxc.rs/docs/guide/usage/linter/rules) for the full list of rules and categories.

## RepoPilot Development

RepoPilot runs as two processes in local development:

| Process  | Command            | URL                   |
| -------- | ------------------ | --------------------- |
| Frontend | `npm run dev`      | http://localhost:5173 |
| Backend  | `npm run dev:server` | http://localhost:3001 |

Or start both together:

```sh
npm run dev:all
```

The frontend calls the backend at `VITE_API_URL` (default
`http://localhost:3001`). If the backend is not running, the login page says
so instead of navigating to a dead URL — start the backend and retry.

### GitHub login (local)

1. Create an OAuth App at GitHub → Settings → Developer settings with:
   - Homepage URL: `http://localhost:5173`
   - Authorization callback URL: `http://localhost:3001/api/auth/github/callback`
2. Copy `.env.example` values into `.env`:
   - `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET`
   - `AUTH_SECRET` (any random string, min 32 chars)
3. Restart the backend, open http://localhost:5173, and sign in with GitHub.

Only identity scopes (`read:user`, `user:email`) are requested. Without
GitHub credentials, sign-in redirects back to the login page with a setup
message instead of authenticating.

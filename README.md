<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/drive/11dry3WW-QpY_YiUsd0jEuZXTlgfW-z3l

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

## Security Hardening: API Key Rotation (v2)

Akai Atlas now uses a hardened key-management layer (`src/apiKeyPool.ts` + `src/atlasClient.ts`):

- **Round-robin rotation** — every request pulls the next key from the pool; no single key absorbs all traffic.
- **Automatic cooldown** — keys hitting 429/quota errors are parked with exponential backoff (30s → 15min cap); invalid keys are permanently quarantined for the session.
- **Retry with failover** — up to 3 retries per request, each attempt rotating to a fresh key, with jittered exponential backoff and a hard 45s deadline per attempt.
- **Runtime injection (recommended)** — serve keys from your web server via `window.__ATLAS_KEYS__` (or pre-obfuscated `__ATLAS_KEYS_OBF__`) in a small script tag so they are never baked into the bundle:
  ```html
  <script>window.__ATLAS_KEYS__ = ["<from-secret-store>"];</script>
  ```
- **Session stash UI** — if no keys are pooled, the app shows a secure prompt; keys are kept only in `sessionStorage` (obfuscated) and die with the tab.
- **Secret redaction** — raw keys are scrubbed from all console logs, error messages, and model output (`redactSecrets`).
- **Input/output filtering** — prompt-injection patterns are blocked client-side; inputs capped at 8k chars; outputs capped at 2,048 tokens; audio uploads restricted to an allowlisted MIME set (≤10MB).
- **Client-side rate limiting** — token bucket (burst 3, ~1 req/2s sustained).

> ⚠️ Note: any key shipped to a browser can be extracted by determined users. For production-grade protection, prefer a thin server proxy that injects keys at runtime (and ideally restricts each Google Cloud key by HTTP referrer).

### Build layout
Vite now emits three cacheable chunks: `index` (app), `react`, and `genai` — resolving the previous >500 kB single-bundle warning.

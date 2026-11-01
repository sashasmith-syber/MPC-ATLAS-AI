/**
 * server/index.ts — Atlas enforcement backend (Node built-in http, zero new deps).
 *
 * Development mode (default): LOOPBACK-ONLY binding (127.0.0.1). Serves the
 * Vite dev app's API needs: session issuance, non-secret status, and the
 * enforced /api/enforce pipeline. NO provider secret ever leaves this process.
 *
 * Production startup FAILS CLOSED unless:
 *   ATLAS_AUTH_MODE=external  (a real verifier is wired in — see auth/session)
 *   Sanctuary policy loads    (config/protos_sanctuary.json)
 * Otherwise the process refuses to start.
 */

import http from 'node:http';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { SessionManager } from './auth/session';
import { Sanctuary, SanctuaryConfigError, loadSanctuaryConfig, resolvePolicyPath } from './protos/sanctuary';
import { GeminiProvider } from './providers/gemini';
import { makeEnforceHandler } from './routes/enforce';
import { makeConsoleSink } from './audit/log';
import { ATLAS_BLUEPRINT } from './blueprint';
import { PROTOCOL_VERSION } from '../shared/contracts/index';

const __dirname_ = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname_, '..');

export interface ServerOptions {
  port?: number;
  host?: string;
  env?: NodeJS.ProcessEnv;
  /** Inject a mock provider in tests; defaults to the real Gemini adapter. */
  provider?: ConstructorParameters<typeof makeEnforceHandler>[0]['provider'];
  sanctuaryPath?: string;
}

export function buildApp(options: ServerOptions = {}) {
  const env = options.env ?? process.env;
  const mode = (env.ATLAS_ENV ?? 'development') as 'development' | 'production';

  if (mode === 'production') {
    // Fail closed: production requires external auth + readable policy.
    if (env.ATLAS_AUTH_MODE !== 'external') {
      throw new Error('refusing to start: production mode without ATLAS_AUTH_MODE=external (no configured authentication)');
    }
  }

  const sessions = new SessionManager(mode === 'production' ? 'production' : 'development');

  const policyPath = resolvePolicyPath(
    env.ATLAS_POLICY_DIR ?? join(ROOT, 'config'),
    options.sanctuaryPath ?? env.ATLAS_SANCTUARY_POLICY ?? 'protos_sanctuary.json',
  );
  let sanctuary: Sanctuary;
  try {
    sanctuary = Sanctuary.fromFile(policyPath);
  } catch (e) {
    if (e instanceof SanctuaryConfigError) {
      // Fail closed at startup: no policy ⇒ no service.
      throw new Error(`refusing to start: sanctuary policy unavailable (${e.message})`);
    }
    throw e;
  }

  const provider = options.provider ?? new GeminiProvider(env);
  const audit = makeConsoleSink();

  const enforce = makeEnforceHandler({
    sessions, sanctuary, provider, audit,
    systemInstruction: ATLAS_BLUEPRINT,
    logicVoters: () => [], // no multi-principal voting infra configured → consensus ops deny
  });

  const handler: http.RequestListener = async (req, res) => {
    const url = req.url ?? '/';
    const method = req.method ?? 'GET';
    const cors = {
      'access-control-allow-origin': env.ATLAS_ALLOWED_ORIGIN ?? 'http://localhost:3000',
      'access-control-allow-headers': 'content-type',
      'access-control-allow-methods': 'POST, GET, OPTIONS',
    };
    if (method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return; }
    const withCors = (h: http.RequestListener) => h; // headers applied per-route below

    try {
      if (method === 'POST' && url === '/api/session') {
        // Dev-mode session issuance. In production an external verifier gates this.
        const rec = await sessions.createSession();
        res.writeHead(200, { 'content-type': 'application/json', ...cors });
        res.end(JSON.stringify({ sessionId: rec.token }));
        return;
      }
      if (method === 'GET' && url === '/api/status') {
        const st = {
          ok: true,
          mode,
          providerConfigured: provider instanceof GeminiProvider ? provider.configured : true,
          protosPolicyLoaded: existsSync(policyPath),
          protocol: PROTOCOL_VERSION,
        };
        res.writeHead(200, { 'content-type': 'application/json', ...cors });
        res.end(JSON.stringify(st));
        return;
      }
      if (method === 'POST' && url === '/api/enforce') {
        await enforce(req, res);
        return;
      }
      res.writeHead(404, { 'content-type': 'application/json', ...cors });
      res.end(JSON.stringify({ ok: false, code: 'INVALID_PACKET', message: 'Not found.' }));
    } catch {
      res.writeHead(500, { 'content-type': 'application/json', ...cors });
      res.end(JSON.stringify({ ok: false, requestId: 'startup', code: 'INTERNAL', message: 'Internal error.' }));
    }
    void withCors;
  };

  return { handler, sessions, sanctuary, provider, policyPath, mode };
}

/** Start loopback-only dev server. Refuses non-loopback bind in development. */
export function startServer(options: ServerOptions = {}) {
  const env = options.env ?? process.env;
  const mode = (env.ATLAS_ENV ?? 'development') as 'development' | 'production';
  const host = options.host ?? env.ATLAS_HOST ?? '127.0.0.1';
  if (mode === 'development' && host !== '127.0.0.1' && host !== 'localhost') {
    throw new Error('development mode must bind to loopback only (127.0.0.1)');
  }
  const port = options.port ?? Number(env.ATLAS_PORT ?? 8787);
  const app = buildApp({ ...options, host });
  const server = http.createServer(app.handler);
  server.listen(port, host, () => {
    process.stdout.write(`[atlas-backend] listening on http://${host}:${port} (${app.mode}; provider=${app.provider instanceof GeminiProvider && !app.provider.configured ? 'NOT CONFIGURED — set GEMINI_API_KEY' : 'configured'})\n`);
  });
  return server;
}

// Direct execution: `node server/index.ts` via tsx-style loaders or after build.
const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) {
  try {
    startServer();
  } catch (e) {
    process.stderr.write(`[atlas-backend] FAILED TO START (fail closed): ${(e as Error).message}\n`);
    process.exit(1);
  }
}

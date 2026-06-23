import type { NextConfig } from 'next';

import { devCorsHeaderRules } from './src/lib/security/dev-cors';

const nextConfig: NextConfig = {
  // Local-development-only CORS for the companion Vite frontend.
  //
  // Production is SAME-ORIGIN (the frontend's vercel.json rewrites /api/* here),
  // so no CORS is needed there — and `devCorsHeaderRules()` returns [] in any
  // real-data/production environment, making this a no-op in production.
  //
  // This is config, NOT middleware: the repo deliberately has no middleware.ts
  // and resolves auth/tenant context per route handler. CORS here only governs
  // the browser preflight for local cross-origin (:5173 -> :3000) smoke testing;
  // it adds no auth and changes no authorization. See src/lib/security/dev-cors.ts.
  async headers() {
    return devCorsHeaderRules();
  },
};

export default nextConfig;

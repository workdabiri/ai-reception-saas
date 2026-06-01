/**
 * Auth.js Route Handler Factory
 *
 * Creates Next.js App Router route handlers (GET/POST) for Auth.js,
 * gated behind the runtime feature flag.
 *
 * When `ENABLE_AUTHJS_RUNTIME !== "true"`, the handlers return a
 * 501 JSON response indicating the runtime is disabled.
 *
 * Design decisions:
 * - Feature-gated: route returns 501 when disabled
 * - JWT session strategy enforced
 * - Adapter is wired through createAuthjsAdapter + createAuthjsAdapterDb
 * - No real providers configured (empty array by default)
 * - No middleware
 * - No request-context integration
 * - AUTH_SECRET validated at initialization time
 *
 * @module
 */

import NextAuth from 'next-auth';
import type { NextAuthResult } from 'next-auth';
import type { NextRequest } from 'next/server';
import { isAuthjsRuntimeEnabled } from './authjs-feature-gate';
import { createAuthjsAdapter } from './authjs-adapter';
import { createAuthjsAdapterDb, type AuthjsPrismaClient } from './authjs-prisma-db';
import { validateAuthjsSecret, AUTHJS_SESSION_STRATEGY } from './authjs-runtime-config';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const AUTHJS_ROUTE_DISABLED_CODE =
  'AUTHJS_RUNTIME_DISABLED' as const;

export const AUTHJS_ROUTE_DISABLED_MESSAGE =
  'Auth.js runtime is disabled.' as const;

export const AUTHJS_ROUTE_DISABLED_STATUS = 501 as const;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Input to the route handler factory.
 */
export interface AuthjsRouteHandlerInput {
  /** Prisma-like client for adapter wiring */
  prisma: AuthjsPrismaClient;
  /** AUTH_SECRET for JWT signing */
  authSecret: string;
  /** Auth.js providers (opaque config objects; empty by default) */
  providers?: unknown[];
  /** Base path for auth routes */
  basePath?: string;
  /** Enable debug logging */
  debug?: boolean;
}

/**
 * Output from the route handler factory.
 */
export interface AuthjsRouteHandlerOutput {
  /** Whether Auth.js runtime was enabled at creation time */
  enabled: boolean;
  /** GET handler for [...nextauth] route */
  GET: (req: NextRequest) => Promise<Response>;
  /** POST handler for [...nextauth] route */
  POST: (req: NextRequest) => Promise<Response>;
  /** Auth.js request-aware session reader — null when disabled */
  auth: ((request: Request) => Promise<Record<string, unknown> | null>) | null;
}

// ---------------------------------------------------------------------------
// Disabled response helper (single source of truth)
// ---------------------------------------------------------------------------

/**
 * Creates a 501 JSON response when Auth.js runtime is disabled.
 *
 * Response body:
 * ```json
 * {
 *   "ok": false,
 *   "error": {
 *     "code": "AUTHJS_RUNTIME_DISABLED",
 *     "message": "Auth.js runtime is disabled."
 *   }
 * }
 * ```
 *
 * Exported so that route.ts can use the same response shape
 * without duplicating construction logic.
 */
export function createDisabledAuthjsRouteResponse(): Response {
  return new Response(
    JSON.stringify({
      ok: false,
      error: {
        code: AUTHJS_ROUTE_DISABLED_CODE,
        message: AUTHJS_ROUTE_DISABLED_MESSAGE,
      },
    }),
    {
      status: AUTHJS_ROUTE_DISABLED_STATUS,
      headers: { 'Content-Type': 'application/json' },
    },
  );
}

// ---------------------------------------------------------------------------
// Route handler factory
// ---------------------------------------------------------------------------

/**
 * Creates Auth.js route handlers gated behind the feature flag.
 *
 * When `ENABLE_AUTHJS_RUNTIME === "true"`:
 * - Validates AUTH_SECRET
 * - Wires adapter via Prisma bridge
 * - Initializes NextAuth with JWT strategy
 * - Returns real GET/POST handlers
 *
 * When disabled:
 * - Returns 501 handlers (no Auth.js initialization)
 *
 * @param input - Route handler configuration
 */
export function createAuthjsRouteHandlers(
  input: AuthjsRouteHandlerInput,
): AuthjsRouteHandlerOutput {
  if (!isAuthjsRuntimeEnabled()) {
    return {
      enabled: false,
      GET: async () => createDisabledAuthjsRouteResponse(),
      POST: async () => createDisabledAuthjsRouteResponse(),
      auth: null,
    };
  }

  // Validate secret before initializing NextAuth
  const secret = validateAuthjsSecret(input.authSecret);

  // Wire adapter: Prisma → AdapterDB → Adapter
  const adapterDb = createAuthjsAdapterDb(input.prisma);
  const adapter = createAuthjsAdapter(adapterDb);

  // Initialize NextAuth with JWT+session callbacks to thread user.id
  const nextAuth: NextAuthResult = NextAuth({
    adapter,
    providers: (input.providers ?? []) as never[],
    session: { strategy: AUTHJS_SESSION_STRATEGY },
    secret,
    basePath: input.basePath,
    debug: input.debug ?? false,
    pages: {
      signIn: '/login',
    },
    callbacks: {
      async jwt({ token, user }) {
        // On sign-in, the user object from DB is present.
        // Auth.js standard: token.sub holds the user's internal ID.
        // We ensure it is set from user.id on sign-in.
        if (user?.id) {
          token.sub = user.id;
        }
        return token;
      },
      async session({ session, token }) {
        // Thread user.id from JWT token.sub into session.user.id
        // token.sub is the Auth.js standard subject claim.
        if (token.sub && session.user) {
          session.user.id = token.sub;
        }
        return session;
      },
    },
  });

  // Wrap NextAuth's overloaded auth() into a request-aware function.
  //
  // Auth.js v5 auth() overloads:
  //   auth()                   → reads session via next/headers (correct for App Router)
  //   auth(request)            → middleware invocation (returns Response, NOT session!)
  //   auth(handlerFn)          → wraps a route handler
  //   auth(req, res)           → Pages Router API routes
  //   auth(getServerSideProps) → Pages Router SSR
  //
  // IMPORTANT: Passing a Request to auth() triggers the middleware path,
  // which returns a Response object instead of a Session. The correct
  // pattern for App Router route handlers is auth() with NO arguments.
  // Auth.js reads cookies from next/headers automatically.
  //
  // The request parameter is kept in the function signature to satisfy
  // the AuthjsSessionReader contract used by the adapter layer.
  const requestAwareAuth = async (
    _request: Request,
  ): Promise<Record<string, unknown> | null> => {
    const session = await nextAuth.auth();
    return session as Record<string, unknown> | null;
  };

  return {
    enabled: true,
    GET: nextAuth.handlers.GET,
    POST: nextAuth.handlers.POST,
    auth: requestAwareAuth,
  };
}

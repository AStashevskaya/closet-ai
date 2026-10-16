import { fromNodeHeaders } from "better-auth/node";
import type { preHandlerAsyncHookHandler } from "fastify";
import type { Auth } from "./auth";

export interface SessionUser {
  id: string;
  email: string;
  name: string;
}

declare module "fastify" {
  interface FastifyRequest {
    // Set by requireUser; null on routes that don't use it.
    user: SessionUser | null;
  }
}

// preHandler for routes that need a signed-in user: replies 401 without a valid session.
export function requireUser(auth: Auth): preHandlerAsyncHookHandler {
  return async (request, reply) => {
    const session = await auth.api.getSession({ headers: fromNodeHeaders(request.headers) });
    if (!session) {
      return reply.code(401).send({ error: "Unauthorized" });
    }
    const { id, email, name } = session.user;
    request.user = { id, email, name };
  };
}

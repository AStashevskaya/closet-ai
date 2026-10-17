import { fromNodeHeaders } from "better-auth/node";
import type { FastifyPluginAsync } from "fastify";
import type { Auth } from "./auth";

// Better Auth speaks the Fetch API, so each Fastify request is converted to a Request
// and the Response is copied back. Pattern from the Better Auth Fastify guide.
export const authRoutes =
  (auth: Auth): FastifyPluginAsync =>
  async (app) => {
    app.route({
      method: ["GET", "POST"],
      url: "/auth/*",
      async handler(request, reply) {
        const url = new URL(request.url, `http://${request.headers.host}`);
        const response = await auth.handler(
          new Request(url, {
            method: request.method,
            headers: fromNodeHeaders(request.headers),
            ...(request.body ? { body: JSON.stringify(request.body) } : {}),
          }),
        );

        reply.status(response.status);
        response.headers.forEach((value, key) => {
          if (key !== "set-cookie") reply.header(key, value);
        });
        // forEach joins several Set-Cookie headers into one invalid header; send them separately.
        const cookies = response.headers.getSetCookie();
        if (cookies.length > 0) reply.header("set-cookie", cookies);

        return reply.send(response.body ? await response.text() : null);
      },
    });
  };

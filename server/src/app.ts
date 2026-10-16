import Fastify from "fastify";
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from "fastify-type-provider-zod";
import type { Auth } from "./auth/auth";
import { authRoutes } from "./auth/auth.routes";
import type { Env } from "./config/env";
import type { ItemsRepository } from "./modules/items/items.repository";
import { itemsRoutes } from "./modules/items/items.routes";
import { healthRoutes } from "./routes/health";

// Dependencies are passed in rather than created here,
// so tests can swap the database for in-memory fakes.
export interface AppDeps {
  env: Env;
  auth: Auth;
  itemsRepository: ItemsRepository;
}

export async function buildApp({ env, auth, itemsRepository }: AppDeps) {
  const app = Fastify({
    logger:
      env.NODE_ENV === "development"
        ? { level: env.LOG_LEVEL, transport: { target: "pino-pretty" } }
        : { level: env.LOG_LEVEL },
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  // Declared up front so every request object has the same shape (a Fastify performance rule).
  app.decorateRequest("user", null);

  await app.register(healthRoutes);
  await app.register(authRoutes(auth), { prefix: "/api" });
  await app.register(itemsRoutes(itemsRepository, auth), { prefix: "/api" });

  return app;
}

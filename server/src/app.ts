import Fastify from "fastify";
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from "fastify-type-provider-zod";
import type { Env } from "./config/env";
import type { ItemsRepository } from "./modules/items/items.repository";
import { itemsRoutes } from "./modules/items/items.routes";
import { healthRoutes } from "./routes/health";

// Dependencies are passed in rather than created here,
// so tests can swap the database for in-memory fakes.
export interface AppDeps {
  env: Env;
  itemsRepository: ItemsRepository;
}

export async function buildApp({ env, itemsRepository }: AppDeps) {
  const app = Fastify({
    logger:
      env.NODE_ENV === "development"
        ? { level: env.LOG_LEVEL, transport: { target: "pino-pretty" } }
        : { level: env.LOG_LEVEL },
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(healthRoutes);
  await app.register(itemsRoutes(itemsRepository), { prefix: "/api" });

  return app;
}

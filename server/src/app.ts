import multipart from "@fastify/multipart";
import Fastify, { type FastifyError } from "fastify";
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
import type { PhotosRepository } from "./modules/photos/photos.repository";
import { photosRoutes } from "./modules/photos/photos.routes";
import { createLimits } from "./modules/usage/limits";
import type { UsageRepository } from "./modules/usage/usage.repository";
import { usageRoutes } from "./modules/usage/usage.routes";
import type { PhotoQueue } from "./queue/photo-queue";
import { healthRoutes } from "./routes/health";
import type { Storage } from "./storage/storage";

// Dependencies are passed in rather than created here,
// so tests can swap the database for in-memory fakes.
export interface AppDeps {
  env: Env;
  auth: Auth;
  itemsRepository: ItemsRepository;
  photosRepository: PhotosRepository;
  usageRepository: UsageRepository;
  photoQueue: PhotoQueue;
  storage: Storage;
  // Whether a tagger is configured (ANTHROPIC_API_KEY); the worker does the tagging.
  taggingEnabled: boolean;
}

// The app sends a photo already shrunk to ~1600 px JPEG (well under 1 MB); the limit only
// stops abuse. The worker re-encodes every upload to a small WebP and deletes the original.
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export async function buildApp({
  env,
  auth,
  itemsRepository,
  photosRepository,
  usageRepository,
  photoQueue,
  storage,
  taggingEnabled,
}: AppDeps) {
  const app = Fastify({
    logger:
      env.NODE_ENV === "development"
        ? { level: env.LOG_LEVEL, transport: { target: "pino-pretty" } }
        : { level: env.LOG_LEVEL },
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  // Fastify's default handler puts error.message into 500 responses, which can leak database
  // details. 4xx errors (validation, 401) are meant for the client and keep their message.
  app.setErrorHandler<FastifyError>((error, request, reply) => {
    const statusCode = error.statusCode ?? 500;
    if (statusCode < 500) return reply.send(error);
    request.log.error({ err: error }, "unhandled error");
    return reply
      .status(statusCode)
      .send({ statusCode, error: "Internal Server Error", message: "Internal Server Error" });
  });

  // Declared up front so every request object has the same shape (a Fastify performance rule).
  app.decorateRequest("user", null);

  await app.register(multipart, { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } });

  await app.register(healthRoutes);
  await app.register(authRoutes(auth), { prefix: "/api" });
  const limits = createLimits(usageRepository, env.AI_DAILY_BUDGET_USD);
  await app.register(itemsRoutes(itemsRepository, photosRepository, storage, photoQueue, auth), {
    prefix: "/api",
  });
  await app.register(
    photosRoutes(
      storage,
      photosRepository,
      itemsRepository,
      photoQueue,
      limits,
      auth,
      taggingEnabled,
    ),
    { prefix: "/api" },
  );
  await app.register(usageRoutes(limits, auth), { prefix: "/api" });

  return app;
}

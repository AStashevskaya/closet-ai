import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/server.ts", "src/worker.ts"],
  format: ["esm"],
  target: "node22",
  clean: true,
  // shared is consumed as TS source, so it has to be bundled into the build
  noExternal: ["@closet-ai/shared"],
});

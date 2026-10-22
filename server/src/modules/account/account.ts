import type { FastifyBaseLogger } from "fastify";
import type { Storage } from "../../storage/storage";
import { photoPrefix, uploadPrefix } from "../photos/photos.routes";

// After an account is deleted: its photos, cut-outs and uploads in storage. The rows are gone
// already (the database cascade), so a failure here is logged rather than undone: the files
// are unreachable either way, and can be removed by prefix later.
export function deleteUserFiles(storage: Storage, log: Pick<FastifyBaseLogger, "error">) {
  return async (userId: string) => {
    for (const prefix of [photoPrefix(userId), uploadPrefix(userId)]) {
      try {
        await storage.deletePrefix(prefix);
      } catch (error) {
        log.error({ err: error, prefix }, "deleting a deleted user's files failed");
      }
    }
  };
}

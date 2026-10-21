import { limitCodeOf, type LimitCode } from '@closet-ai/shared';

// A non-2xx answer from the API, with the server's message. On its own module, without
// api.ts's native imports, so screens and their tests can read errors without the network code.
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

// The server couldn't be reached at all (no internet, or the server is down or restarting):
// screens say so instead of blaming the photo.
export class OfflineError extends Error {}

export const isOffline = (error: unknown) => error instanceof OfflineError;

// Which free-tier limit a failed call ran into, if that's why it failed.
export function limitReached(error: unknown): LimitCode | null {
  if (!(error instanceof ApiError) || error.status !== 429) return null;
  return limitCodeOf(error.message);
}

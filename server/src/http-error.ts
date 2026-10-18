// A 4xx error for the client. The app's error handler sends it as
// { statusCode, error, message }, so handlers can throw instead of declaring every
// error status in their response schema.
export function httpError(statusCode: number, message: string) {
  return Object.assign(new Error(message), { statusCode });
}

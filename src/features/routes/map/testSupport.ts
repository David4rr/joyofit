/**
 * The error a promise rejects with, as a value. `expect(promise).rejects` in `bun test` waits for the promise by running the event
 * loop right there, so it deadlocks when the test only settles the promise afterwards (an abort, a timer, a release).
 */
export async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('the promise resolved');
}

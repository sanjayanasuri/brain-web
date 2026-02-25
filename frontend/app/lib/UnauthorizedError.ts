/**
 * Thrown when an API returns 401. Handled globally to redirect to login.
 */
export class UnauthorizedError extends Error {
  override name = 'UnauthorizedError';

  constructor() {
    super('Session expired or unauthorized');
  }
}

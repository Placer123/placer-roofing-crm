// Carries the logged-in user (or null) for the duration of one request,
// without threading it as an extra parameter through every route handler and
// every page-render function. server.js wraps each request in als.run(...);
// anything called during that request -- deep inside ui-routes.js or a
// pages/*.js render function -- can call getCurrentUser() and get the right
// answer, even though nothing passed it there explicitly.
import { AsyncLocalStorage } from 'node:async_hooks';

export const als = new AsyncLocalStorage();

/** { id, role, rep, name, market } for the logged-in user, or null if not logged in (or outside a request). */
export function getCurrentUser() {
  return als.getStore()?.user || null;
}

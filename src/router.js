// Minimal router: supports static segments and :param segments, one handler per method+path.

export class Router {
  constructor() {
    this.routes = []; // { method, regex, keys, handler }
  }

  _add(method, pattern, handler) {
    const keys = [];
    const regexStr = pattern
      .replace(/\/+$/, '') // strip trailing slash
      .split('/')
      .map((seg) => {
        if (seg.startsWith(':')) {
          keys.push(seg.slice(1));
          return '([^/]+)';
        }
        return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      })
      .join('/');
    const regex = new RegExp(`^${regexStr}/?$`);
    this.routes.push({ method, regex, keys, handler });
  }

  get(pattern, handler) { this._add('GET', pattern, handler); }
  post(pattern, handler) { this._add('POST', pattern, handler); }
  patch(pattern, handler) { this._add('PATCH', pattern, handler); }
  put(pattern, handler) { this._add('PUT', pattern, handler); }
  delete(pattern, handler) { this._add('DELETE', pattern, handler); }

  /** Returns { handler, params } for the first matching route, or null. */
  match(method, pathname) {
    for (const route of this.routes) {
      if (route.method !== method) continue;
      const m = route.regex.exec(pathname);
      if (!m) continue;
      const params = {};
      route.keys.forEach((key, i) => { params[key] = decodeURIComponent(m[i + 1]); });
      return { handler: route.handler, params };
    }
    return null;
  }
}

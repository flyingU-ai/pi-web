/** Browser-only display leaf from the non-secret cookie. Do not import Node ALS here. */

function sanitize(leaf: string): string {
  const name = String(leaf || "")
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .slice(0, 80);
  if (!name || name === "." || name === ".." || name === "_") return "";
  return name;
}

export function clientWebAdmin(cookieSource?: string): string {
  const raw = cookieSource ?? (typeof document !== "undefined" ? document.cookie : "");
  const match = /(?:^|; )aoi_leaf=([^;]*)/.exec(raw);
  if (!match) return "";
  try {
    return sanitize(decodeURIComponent(match[1]));
  } catch {
    return sanitize(match[1]);
  }
}

const BOUND_LEAF_KEY = "aoi_leaf_bound";

/** Leaf this document opened with. A later login in another tab must not retarget it. */
export function boundWebAdmin(): string {
  if (typeof sessionStorage === "undefined") return clientWebAdmin();
  const stored = sanitize(sessionStorage.getItem(BOUND_LEAF_KEY) || "");
  if (stored) return stored;
  const leaf = clientWebAdmin();
  if (leaf) sessionStorage.setItem(BOUND_LEAF_KEY, leaf);
  return leaf;
}

/**
 * Runs before the app fetches. Binds the leaf from the cookie at this document
 * load, then sends it on every /api call. The signed cookie stays the login.
 */
export const ADMIN_LEAF_FETCH_SCRIPT = `(function(){if(window.__aoiFetchScoped)return;window.__aoiFetchScoped=true;var m=/(?:^|; )aoi_leaf=([^;]*)/.exec(document.cookie||"");var raw="";try{raw=m?decodeURIComponent(m[1]):""}catch(e){raw=m?m[1]:""}raw=String(raw||"").trim();if(!/^[A-Za-z0-9._-]{1,80}$/.test(raw)||raw==="_"||raw==="."||raw==="..")raw="";if(raw)sessionStorage.setItem(${JSON.stringify(BOUND_LEAF_KEY)},raw);var bound=raw;var orig=window.fetch.bind(window);window.fetch=function(input,init){var url=typeof input==="string"?input:input instanceof URL?input.href:(input&&input.url)||"";if(!String(url).includes("/api/"))return orig(input,init);var headers=new Headers((init&&init.headers)||(input instanceof Request?input.headers:undefined));if(bound)headers.set("x-aoi-admin",bound);else headers.delete("x-aoi-admin");var next=Object.assign({},init,{headers:headers,credentials:(init&&init.credentials)||"same-origin"});return orig(input,next);};})();`;

/** Same-origin fetches. The header is the leaf this page opened with, not a login. */
export function adminFetchInit(init: RequestInit = {}): RequestInit {
  const headers = new Headers(init.headers);
  const leaf = boundWebAdmin();
  if (leaf) headers.set("x-aoi-admin", leaf);
  else headers.delete("x-aoi-admin");
  return { credentials: "same-origin", ...init, headers };
}

export function adminScopedStorageKey(base: string, admin = clientWebAdmin()): string {
  return `${base}:${admin || "_none"}`;
}

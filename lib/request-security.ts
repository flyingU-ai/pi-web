import { isIP } from "node:net";

function normalizeHostname(value: string): string {
  const unbracketed = value.startsWith("[") && value.endsWith("]")
    ? value.slice(1, -1)
    : value;
  return unbracketed.toLowerCase().replace(/\.$/, "");
}

function hostnameFromAuthority(value: string): string | null {
  if (!value || /[\s/@\\]/.test(value)) return null;
  try {
    const parsed = new URL(`http://${value}`);
    if (parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash) {
      return null;
    }
    return normalizeHostname(parsed.hostname);
  } catch {
    return null;
  }
}

function normalizeAuthority(value: string): string | null {
  if (!value || /[\s/@\\]/.test(value)) return null;
  try {
    const parsed = new URL(`http://${value}`);
    if (parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash) {
      return null;
    }
    const hostname = normalizeHostname(parsed.hostname);
    return parsed.port ? `${hostname}:${parsed.port}` : hostname;
  } catch {
    return null;
  }
}

function normalizeConfiguredHostname(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return isIP(trimmed) ? normalizeHostname(trimmed) : hostnameFromAuthority(trimmed);
}

function isLoopbackHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname.endsWith(".localhost");
}

function configuredHostnamesFromEnvironment(): string[] {
  return [
    process.env.PI_WEB_HOSTNAME,
    ...(process.env.PI_WEB_ALLOWED_HOSTS?.split(",") ?? []),
  ].filter((value): value is string => Boolean(value?.trim()));
}

const LAB_FRONT_PORTS = new Set(["5174", "5184", "8001", "8800"]);

function configuredLabOrigins(): string[] {
  return [
    ...(process.env.PI_WEB_LAB_ORIGINS?.split(",") ?? []),
    ...(process.env.PI_WEB_ALLOWED_ORIGINS?.split(",") ?? []),
  ].map((value) => value.trim()).filter(Boolean);
}

/** :5184 / :5174 on the same host as this assistant, plus explicit env origins. */
export function isLabFrontOrigin(origin: string, request: Request): boolean {
  const wanted = canonicalOrigin(origin);
  if (!wanted) return false;
  for (const raw of configuredLabOrigins()) {
    if (canonicalOrigin(raw) === wanted) return true;
  }
  const host = hostnameFromAuthority(request.headers.get("host") || "");
  if (!host) return false;
  try {
    const parsed = new URL(origin);
    if (normalizeHostname(parsed.hostname) !== host) return false;
    return LAB_FRONT_PORTS.has(parsed.port);
  } catch {
    return false;
  }
}

function canonicalOrigin(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function getRequestOrigin(request: Request): string | null {
  const requestUrl = new URL(request.url);
  const host = request.headers.get("host");
  return host ? canonicalOrigin(`${requestUrl.protocol}//${host}`) : null;
}

function isUserInitiatedSessionExportNavigation(request: Request): boolean {
  if (
    request.method !== "GET"
    || request.headers.get("sec-fetch-mode") !== "navigate"
    || request.headers.get("sec-fetch-dest") !== "document"
    || request.headers.get("sec-fetch-user") !== "?1"
  ) {
    return false;
  }

  try {
    return /^\/api\/sessions\/[^/]+\/export$/.test(new URL(request.url).pathname);
  } catch {
    return false;
  }
}

/**
 * Only trust local names, IP literals, or the hostname explicitly selected by
 * the operator. IP literals preserve LAN access but cannot be DNS-rebound
 * because the browser keeps the literal address in the Host header.
 */
export function isApiRequestHostAllowed(
  request: Request,
  configuredHostnames = configuredHostnamesFromEnvironment(),
): boolean {
  const host = request.headers.get("host");
  const hostname = host ? hostnameFromAuthority(host) : null;
  if (!hostname) return false;
  if (isLoopbackHostname(hostname) || isIP(hostname)) return true;

  return configuredHostnames.some(
    (configured) => normalizeConfiguredHostname(configured) === hostname,
  );
}

/**
 * A relay can report the external scheme in `x-forwarded-proto` while rewriting
 * `Origin` onto the backend authority, so the two disagree on the scheme alone
 * for a request that really is same-origin (Azure Dev Tunnels does this). Accept
 * that pairing only when the Origin's authority still equals the Host header,
 * a proxy is in front, and Fetch Metadata still reports a same-origin request.
 */
function isProxyRewrittenSameOrigin(request: Request, origin: string): boolean {
  if (
    request.headers.get("sec-fetch-site") !== "same-origin"
    || !request.headers.get("x-forwarded-proto")
  ) return false;

  const host = request.headers.get("host");
  if (!host) return false;

  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    return false;
  }

  const originAuthority = normalizeAuthority(originHost);
  return originAuthority !== null && originAuthority === normalizeAuthority(host);
}

/** Reject browser cross-site API requests while preserving non-browser clients. */
export function isApiRequestOriginAllowed(request: Request): boolean {
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  if (origin && isLabFrontOrigin(origin, request)) return true;
  if (fetchSite === "cross-site") return false;
  if (!origin) return true;

  const requestOrigin = getRequestOrigin(request);
  if (requestOrigin !== null && canonicalOrigin(origin) === requestOrigin) return true;

  return isProxyRewrittenSameOrigin(request, origin);
}

export function shouldCheckApiRequestOrigin(request: Request): boolean {
  return request.headers.has("origin") || request.headers.has("sec-fetch-site");
}

export function isApiRequestAllowed(
  request: Request,
  configuredHostnames = configuredHostnamesFromEnvironment(),
): boolean {
  if (!isApiRequestHostAllowed(request, configuredHostnames)) return false;
  if (isUserInitiatedSessionExportNavigation(request)) return true;
  return !shouldCheckApiRequestOrigin(request) || isApiRequestOriginAllowed(request);
}

export function hasJsonContentType(request: Request): boolean {
  const mediaType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  return mediaType === "application/json"
    || Boolean(mediaType?.startsWith("application/") && mediaType.endsWith("+json"));
}

import { NextResponse, type NextRequest } from "next/server";
import { isBlockedAdminLeaf } from "@/lib/admin-leaf";
import { signAdminCookie, ticketSecret, verifyAdminTicket } from "@/lib/admin-ticket";
import {
  getAuthRetryAfterMs,
  recordAuthFailure,
  retryAfterSeconds,
} from "@/lib/auth-throttle";
import {
  isApiRequestAllowed,
  isApiRequestHostAllowed,
  isLabFrontOrigin,
} from "@/lib/request-security";
import {
  isValidWebSessionToken,
  isValidBasicAuthorization,
  isWebPasswordEnabled,
  PI_WEB_SESSION_COOKIE,
} from "@/lib/web-auth";
import { adminCookieIsSigned, leafFromAdminCookie, multiUserMode, WEB_ADMIN_COOKIE, WEB_ADMIN_HEADER } from "@/lib/web-admin-scope";

function sanitizeWebAdmin(admin: string): string {
  const name = String(admin || "")
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .slice(0, 80);
  if (!name || name === "." || name === ".." || isBlockedAdminLeaf(name)) return "";
  return name;
}

function isolationEnabled(): boolean {
  return multiUserMode();
}

function cookieValue(header: string, name: string): string {
  const prefix = `${name}=`;
  for (const part of String(header || "").split(";")) {
    const piece = part.trim();
    if (!piece.startsWith(prefix)) continue;
    try {
      return decodeURIComponent(piece.slice(prefix.length));
    } catch {
      return piece.slice(prefix.length);
    }
  }
  return "";
}

function isSpaNavigation(request: NextRequest): boolean {
  const dest = (request.headers.get("sec-fetch-dest") || "").toLowerCase();
  if (dest === "empty") return true;
  return Boolean(
    request.headers.get("rsc")
    || request.headers.get("next-router-state-tree")
    || request.headers.get("next-router-prefetch")
    || request.headers.get("next-url"),
  );
}

function setLeafCookies(response: NextResponse, leaf: string): void {
  const options = { path: "/", sameSite: "lax" as const, maxAge: 60 * 60 * 24 * 30 };
  const adminValue = adminCookieIsSigned() ? signAdminCookie(leaf, ticketSecret()) : leaf;
  response.cookies.set(WEB_ADMIN_COOKIE, adminValue, { ...options, httpOnly: true });
  response.cookies.set("aoi_leaf", leaf, { ...options, httpOnly: false });
}

function applyClearCors(request: NextRequest, response: NextResponse): NextResponse {
  const origin = request.headers.get("origin") || "";
  let originHost = "";
  try {
    originHost = origin ? new URL(origin).hostname : "";
  } catch {
    originHost = "";
  }
  const host = (request.headers.get("host") || "").replace(/:\d+$/, "");
  const sameHost = Boolean(originHost && originHost === host);
  if (!sameHost && !isLabFrontOrigin(origin, request)) return response;
  response.headers.set("Access-Control-Allow-Origin", origin);
  response.headers.set("Access-Control-Allow-Credentials", "true");
  response.headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  response.headers.set("Access-Control-Allow-Headers", "content-type");
  response.headers.set("Vary", "Origin");
  return response;
}

function isAssistantLogout(request: NextRequest): boolean {
  return request.nextUrl.pathname === "/api/web-admin"
    && (request.method === "POST" || request.method === "OPTIONS");
}

function unauthorized(): NextResponse {
  const html = `<!doctype html>
<html lang="zh-CN">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>助手登录</title>
<body style="font:14px/1.5 system-ui,sans-serif;padding:24px;color:#111">
  <p>需要从标注平台登录后打开助手</p>
  <p style="color:#666;font-size:12px">作业台已登录时点下面按钮重新打开，不要停在这页。</p>
  <button type="button" onclick="try{parent.postMessage({type:'piweb-reopen'},'*')}catch(e){};location.reload()">重新打开助手</button>
  <script>try{parent.postMessage({type:'piweb-auth-failed'},'*')}catch(e){}</script>
</body>
</html>`;
  return new NextResponse(html, {
    status: 401,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function untrusted(request: NextRequest, api: boolean): NextResponse {
  const host = request.headers.get("host") || "";
  const origin = request.headers.get("origin") || "";
  const detail = `Untrusted request · Host=${host}${origin ? ` Origin=${origin}` : ""} · 作业台 :5184/:5174 同主机应放行`;
  if (api) {
    return NextResponse.json({ error: "Untrusted API request", host, origin, detail }, { status: 403 });
  }
  return new NextResponse(detail, {
    status: 403,
    headers: { "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8" },
  });
}

function leafMismatch(): NextResponse {
  return new NextResponse("管理员身份不一致", {
    status: 403,
    headers: { "Cache-Control": "no-store" },
  });
}

/** Ticket exchange, or the cookie it already set. `?admin=` does not choose a leaf. */
function withVerifiedLeaf(request: NextRequest, response: NextResponse): NextResponse {
  const isApiRequest = request.nextUrl.pathname === "/api"
    || request.nextUrl.pathname.startsWith("/api/");
  if (request.nextUrl.pathname === "/api/web-admin" && request.method === "POST") {
    return response;
  }
  const ticket = request.nextUrl.searchParams.get("ticket") || "";
  const leaf = ticket ? verifyAdminTicket(ticket, ticketSecret()) : "";
  const cookie = leafFromAdminCookie(cookieValue(request.headers.get("cookie") || "", WEB_ADMIN_COOKIE));
  const header = sanitizeWebAdmin(request.headers.get(WEB_ADMIN_HEADER) || "");
  const queryAdmin = sanitizeWebAdmin(request.nextUrl.searchParams.get("admin") || "");

  if (ticket) {
    if (!leaf) return unauthorized();
    if ((header && header !== leaf) || (queryAdmin && queryAdmin !== leaf)) return leafMismatch();
    if (!isApiRequest) {
      const clean = request.nextUrl.clone();
      clean.searchParams.delete("ticket");
      clean.searchParams.delete("admin");
      const redirected = NextResponse.redirect(clean, 303);
      setLeafCookies(redirected, leaf);
      return redirected;
    }
    setLeafCookies(response, leaf);
    return response;
  }

  if (header && header !== cookie) return leafMismatch();
  if (queryAdmin && queryAdmin !== cookie) return leafMismatch();
  if (!cookie) return unauthorized();
  return response;
}

function withAdminCookie(request: NextRequest, res: NextResponse): NextResponse {
  if (isolationEnabled()) return withVerifiedLeaf(request, res);
  const isApiRequest = request.nextUrl.pathname === "/api"
    || request.nextUrl.pathname.startsWith("/api/");
  const admin = sanitizeWebAdmin(request.nextUrl.searchParams.get("admin") || "");
  if (admin) {
    res.cookies.set("aoi_admin", admin, {
      path: "/",
      sameSite: "lax",
      httpOnly: true,
      maxAge: 60 * 60 * 24 * 30,
    });
  } else if (!isApiRequest && !isSpaNavigation(request)) {
    // Full document / iframe load without ?admin= must not inherit the previous login.
    // App Router client navigations (dest=empty or RSC) keep the current cookie.
    res.cookies.set("aoi_admin", "", { path: "/", sameSite: "lax", httpOnly: true, maxAge: 0 });
  }
  return res;
}

function tooManyAttempts(retryAfterMs: number): NextResponse {
  return new NextResponse("Too many failed attempts", {
    status: 429,
    headers: {
      "Cache-Control": "no-store",
      "Retry-After": String(retryAfterSeconds(retryAfterMs)),
    },
  });
}

export function proxy(request: NextRequest) {
  if (isAssistantLogout(request)) {
    if (request.method === "OPTIONS") {
      return applyClearCors(request, new NextResponse(null, { status: 204 }));
    }
    return applyClearCors(request, NextResponse.next());
  }
  const isApiRequest = request.nextUrl.pathname === "/api"
    || request.nextUrl.pathname.startsWith("/api/");
  const isTrustedRequest = isApiRequest
    ? isApiRequestAllowed(request)
    : isApiRequestHostAllowed(request);

  if (!isTrustedRequest) {
    return untrusted(request, isApiRequest);
  }

  const password = process.env.PI_WEB_PASSWORD;
  if (!isWebPasswordEnabled(password)) {
    if (request.nextUrl.pathname === "/login") {
      return NextResponse.redirect(new URL("/", request.url));
    }
    return withAdminCookie(request, NextResponse.next());
  }

  let authenticated = isValidWebSessionToken(request.cookies.get(PI_WEB_SESSION_COOKIE)?.value, password);
  const authorization = isApiRequest ? request.headers.get("authorization") : null;
  if (!authenticated && authorization && /^Basic\s/i.test(authorization)) {
    // Every Basic header is a password guess, so it shares the login form's
    // throttle; otherwise any API path (or GET /api/web-auth) answers guesses
    // at full speed. While blocked even the right password is refused, or the
    // answer would leak. A success does not reset the counter: Basic clients
    // authenticate on every request, and each reset would hand an interleaved
    // guesser a fresh short block.
    const retryAfterMs = getAuthRetryAfterMs();
    if (retryAfterMs > 0) return tooManyAttempts(retryAfterMs);
    authenticated = isValidBasicAuthorization(authorization, password);
    if (!authenticated) recordAuthFailure();
  }
  if (request.nextUrl.pathname === "/login") {
    return authenticated
      ? NextResponse.redirect(new URL("/", request.url))
      : withAdminCookie(request, NextResponse.next());
  }
  if (request.nextUrl.pathname === "/api/web-auth") return withAdminCookie(request, NextResponse.next());

  if (!authenticated) {
    if (!isApiRequest) {
      const loginUrl = new URL("/login", request.url);
      if (request.nextUrl.search) {
        loginUrl.searchParams.set("next", `${request.nextUrl.pathname}${request.nextUrl.search}`);
      }
      return NextResponse.redirect(loginUrl);
    }
    return new NextResponse("Authentication required", {
      status: 401,
      headers: {
        "Cache-Control": "no-store",
        "WWW-Authenticate": 'Basic realm="agentSMark", charset="UTF-8"',
      },
    });
  }

  return withAdminCookie(request, NextResponse.next());
}

export const config = { matcher: ["/", "/login", "/api/:path*"] };

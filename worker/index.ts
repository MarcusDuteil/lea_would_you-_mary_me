import {
  DEFAULT_DEVICE_SIZES,
  DEFAULT_IMAGE_SIZES,
  handleImageOptimization,
} from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const RETENTION_DAYS = 30;
const RETENTION_MS = RETENTION_DAYS * 24 * 60 * 60 * 1000;
const TURNSTILE_ALWAYS_PASS_TEST_SECRET = "1x0000000000000000000000000000000AA";
const PDF_ACTIVE_CONTENT_MARKERS = [
  "/JavaScript",
  "/JS",
  "/Launch",
  "/EmbeddedFile",
  "/RichMedia",
  "/OpenAction",
];

interface Env {
  ASSETS: Fetcher;
  CV_FILES: R2Bucket;
  TURNSTILE_SECRET_KEY?: string;
  ALLOWED_ORIGINS?: string;
  PUBLIC_BASE_URL?: string;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

function json(data: unknown, status = 200, headers: HeadersInit = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...headers,
    },
  });
}

function allowedOrigin(request: Request, env: Env) {
  const requestUrl = new URL(request.url);
  const origin = request.headers.get("Origin");
  if (!origin) return "";

  const configuredOrigins = (env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

  if (origin === requestUrl.origin || configuredOrigins.includes(origin)) {
    return origin;
  }

  return null;
}

function corsHeaders(origin: string) {
  return origin
    ? {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": "POST, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Authorization, Content-Type",
        Vary: "Origin",
      }
    : {};
}

function randomToken(byteLength: number) {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hashToken(token: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function constantTimeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

async function verifyTurnstile(request: Request, env: Env, token: string) {
  if (!env.TURNSTILE_SECRET_KEY) return false;

  const body = new FormData();
  body.set("secret", env.TURNSTILE_SECRET_KEY);
  body.set("response", token);
  const remoteIp = request.headers.get("CF-Connecting-IP");
  if (remoteIp) body.set("remoteip", remoteIp);

  const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    body,
  });
  if (!response.ok) return false;

  const result = (await response.json()) as {
    success?: boolean;
    hostname?: string;
    action?: string;
  };
  if (result.success !== true) {
    return false;
  }

  // Cloudflare's documented test key returns synthetic metadata. Keep strict
  // hostname and action validation for every real production secret.
  if (env.TURNSTILE_SECRET_KEY === TURNSTILE_ALWAYS_PASS_TEST_SECRET) return true;

  if (result.action !== "cv_upload" || !result.hostname) return false;

  const trustedHostnames = new Set([new URL(request.url).hostname]);
  for (const origin of (env.ALLOWED_ORIGINS ?? "").split(",")) {
    try {
      if (origin.trim()) trustedHostnames.add(new URL(origin.trim()).hostname);
    } catch {
      // Ignore malformed configuration entries instead of trusting them.
    }
  }

  return trustedHostnames.has(result.hostname);
}

function safeFilename(name: string) {
  const withoutExtension = name.replace(/\.pdf$/i, "");
  const cleaned = withoutExtension
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9 _-]/g, "")
    .trim()
    .slice(0, 70);
  return `${cleaned || "cv"}.pdf`;
}

function hasPdfSignature(bytes: Uint8Array) {
  return new TextDecoder().decode(bytes.slice(0, 5)) === "%PDF-";
}

function containsActivePdfContent(bytes: Uint8Array) {
  const text = new TextDecoder("latin1").decode(bytes);
  return PDF_ACTIVE_CONTENT_MARKERS.some((marker) => text.includes(marker));
}

async function uploadCv(request: Request, env: Env, origin: string) {
  const contentLength = Number(request.headers.get("Content-Length") ?? "0");
  if (contentLength > MAX_FILE_BYTES + 256 * 1024) {
    return json({ error: "Le fichier dépasse la limite de 10 Mo." }, 413, corsHeaders(origin));
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return json({ error: "Le formulaire envoyé n’est pas valide." }, 400, corsHeaders(origin));
  }

  const turnstileToken = formData.get("cf-turnstile-response");
  if (typeof turnstileToken !== "string" || !(await verifyTurnstile(request, env, turnstileToken))) {
    return json({ error: "La vérification anti-robots a échoué." }, 403, corsHeaders(origin));
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return json({ error: "Aucun CV n’a été reçu." }, 400, corsHeaders(origin));
  }

  if (
    file.size === 0 ||
    file.size > MAX_FILE_BYTES ||
    file.type !== "application/pdf" ||
    !file.name.toLowerCase().endsWith(".pdf")
  ) {
    return json({ error: "Le fichier doit être un PDF de 10 Mo maximum." }, 400, corsHeaders(origin));
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!hasPdfSignature(bytes)) {
    return json({ error: "La signature du fichier PDF est invalide." }, 400, corsHeaders(origin));
  }

  if (containsActivePdfContent(bytes)) {
    return json(
      { error: "Ce PDF contient des fonctions actives ou des pièces jointes non autorisées." },
      400,
      corsHeaders(origin),
    );
  }

  const id = crypto.randomUUID();
  const deleteToken = randomToken(32);
  const deleteTokenHash = await hashToken(deleteToken);
  const expiresAt = new Date(Date.now() + RETENTION_MS).toISOString();
  const filename = safeFilename(file.name);

  await env.CV_FILES.put(`cv/${id}.pdf`, bytes, {
    httpMetadata: {
      contentType: "application/pdf",
      contentDisposition: `inline; filename="${filename}"`,
      cacheControl: "private, max-age=300",
    },
    customMetadata: {
      expiresAt,
      deleteTokenHash,
      filename,
    },
  });

  const requestUrl = new URL(request.url);
  const publicBase = (env.PUBLIC_BASE_URL || requestUrl.origin).replace(/\/$/, "");

  return json(
    {
      id,
      viewUrl: `${publicBase}/cv/${id}`,
      deleteToken,
      expiresAt,
    },
    201,
    corsHeaders(origin),
  );
}

async function serveCv(request: Request, env: Env, id: string) {
  const object = await env.CV_FILES.get(`cv/${id}.pdf`);
  if (!object) return new Response("CV introuvable", { status: 404 });

  const expiresAt = object.customMetadata?.expiresAt;
  if (!expiresAt || Date.parse(expiresAt) <= Date.now()) {
    await env.CV_FILES.delete(`cv/${id}.pdf`);
    return new Response("Ce CV a expiré", { status: 410 });
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("ETag", object.httpEtag);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Content-Security-Policy", "sandbox");
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
  headers.set("Cross-Origin-Resource-Policy", "cross-origin");

  return new Response(request.method === "HEAD" ? null : object.body, { headers });
}

async function deleteCv(request: Request, env: Env, origin: string, id: string) {
  const authorization = request.headers.get("Authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!token) return json({ error: "Jeton de suppression manquant." }, 401, corsHeaders(origin));

  const object = await env.CV_FILES.head(`cv/${id}.pdf`);
  if (!object) return json({ error: "CV introuvable." }, 404, corsHeaders(origin));

  const expectedHash = object.customMetadata?.deleteTokenHash ?? "";
  const receivedHash = await hashToken(token);
  if (!constantTimeEqual(receivedHash, expectedHash)) {
    return json({ error: "Jeton de suppression invalide." }, 403, corsHeaders(origin));
  }

  await env.CV_FILES.delete(`cv/${id}.pdf`);
  return json({ deleted: true }, 200, corsHeaders(origin));
}

function withSecurityHeaders(response: Response) {
  const secured = new Response(response.body, response);
  secured.headers.set("X-Content-Type-Options", "nosniff");
  secured.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  secured.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  secured.headers.set("X-Frame-Options", "DENY");
  secured.headers.set("Content-Security-Policy", [
    "default-src 'self'",
    "script-src 'self' https://challenges.cloudflare.com",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "frame-src https://challenges.cloudflare.com",
    "connect-src 'self' https://challenges.cloudflare.com",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; "));
  return secured;
}

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const origin = allowedOrigin(request, env);

    if (url.pathname.startsWith("/api/") && origin === null) {
      return json({ error: "Origine non autorisée." }, 403);
    }

    if (request.method === "OPTIONS" && url.pathname.startsWith("/api/")) {
      return new Response(null, { status: 204, headers: corsHeaders(origin || "") });
    }

    if (request.method === "POST" && url.pathname === "/api/upload") {
      return uploadCv(request, env, origin || "");
    }

    const fileMatch = url.pathname.match(/^\/api\/files\/([0-9a-f-]{36})$/i);
    if (request.method === "DELETE" && fileMatch) {
      return deleteCv(request, env, origin || "", fileMatch[1]);
    }

    const cvMatch = url.pathname.match(/^\/cv\/([0-9a-f-]{36})$/i);
    if ((request.method === "GET" || request.method === "HEAD") && cvMatch) {
      return serveCv(request, env, cvMatch[1]);
    }

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(
        request,
        {
          fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
          transformImage: async (body, { width, format, quality }) => {
            const result = await env.IMAGES.input(body)
              .transform(width > 0 ? { width } : {})
              .output({ format, quality });
            return result.response();
          },
        },
        allowedWidths,
      );
    }

    return withSecurityHeaders(await handler.fetch(request, env, ctx));
  },
};

export default worker;

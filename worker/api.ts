const MAX_FILE_BYTES = 10 * 1024 * 1024;
const RETENTION_DAYS = 30;
const RETENTION_SECONDS = RETENTION_DAYS * 24 * 60 * 60;
const TURNSTILE_ALWAYS_PASS_TEST_SECRET = "1x0000000000000000000000000000000AA";
const PDF_ACTIVE_CONTENT_MARKERS = [
  "/JavaScript",
  "/JS",
  "/Launch",
  "/EmbeddedFile",
  "/RichMedia",
  "/OpenAction",
];

export type ApiEnv = Cloudflare.Env;

interface CvMetadata {
  expiresAt: string;
  deleteTokenHash: string;
  filename: string;
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

function allowedOrigin(request: Request, env: ApiEnv) {
  const requestUrl = new URL(request.url);
  const origin = request.headers.get("Origin");
  if (!origin) return "";

  const configuredOrigins = (env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

  if (origin === requestUrl.origin || configuredOrigins.includes(origin)) return origin;
  return null;
}

function corsHeaders(origin: string): HeadersInit {
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

async function verifyTurnstile(request: Request, env: ApiEnv, token: string) {
  if (!env.TURNSTILE_SECRET_KEY || token.length === 0 || token.length > 2048) return false;

  const body = new URLSearchParams({
    secret: env.TURNSTILE_SECRET_KEY,
    response: token,
  });
  const remoteIp = request.headers.get("CF-Connecting-IP");
  if (remoteIp) body.set("remoteip", remoteIp);

  try {
    const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return false;

    const result = (await response.json()) as {
      success?: boolean;
      hostname?: string;
      action?: string;
    };
    if (result.success !== true) return false;

    // Cloudflare test keys return synthetic metadata. Production keys always
    // require the expected action and an explicitly trusted frontend hostname.
    if (env.TURNSTILE_SECRET_KEY === TURNSTILE_ALWAYS_PASS_TEST_SECRET) return true;
    if (result.action !== "cv_upload" || !result.hostname) return false;

    const trustedHostnames = new Set([new URL(request.url).hostname]);
    for (const origin of (env.ALLOWED_ORIGINS ?? "").split(",")) {
      try {
        if (origin.trim()) trustedHostnames.add(new URL(origin.trim()).hostname);
      } catch {
        // A malformed configuration entry is ignored, never trusted.
      }
    }
    return trustedHostnames.has(result.hostname);
  } catch {
    return false;
  }
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

async function uploadCv(request: Request, env: ApiEnv, origin: string) {
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

  const fileBuffer = await file.arrayBuffer();
  const bytes = new Uint8Array(fileBuffer);
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
  const expiresAt = new Date(Date.now() + RETENTION_SECONDS * 1000).toISOString();
  const filename = safeFilename(file.name);
  const metadata: CvMetadata = { expiresAt, deleteTokenHash, filename };

  await env.CV_FILES.put(`cv/${id}.pdf`, fileBuffer, {
    expirationTtl: RETENTION_SECONDS,
    metadata,
  });

  const requestUrl = new URL(request.url);
  const publicBase = (env.PUBLIC_BASE_URL || requestUrl.origin).replace(/\/$/, "");
  return json(
    { id, viewUrl: `${publicBase}/cv/${id}`, deleteToken, expiresAt },
    201,
    corsHeaders(origin),
  );
}

async function serveCv(request: Request, env: ApiEnv, id: string) {
  const object = await env.CV_FILES.getWithMetadata<CvMetadata>(`cv/${id}.pdf`, "stream");
  if (!object.value || !object.metadata) return new Response("CV introuvable", { status: 404 });

  if (Date.parse(object.metadata.expiresAt) <= Date.now()) {
    await env.CV_FILES.delete(`cv/${id}.pdf`);
    return new Response("Ce CV a expiré", { status: 410 });
  }

  const headers = new Headers({
    "Content-Type": "application/pdf",
    "Content-Disposition": `inline; filename="${object.metadata.filename}"`,
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "sandbox",
    "Referrer-Policy": "no-referrer",
    "X-Robots-Tag": "noindex, nofollow, noarchive",
    "Cross-Origin-Resource-Policy": "cross-origin",
  });
  return new Response(request.method === "HEAD" ? null : object.value, { headers });
}

async function deleteCv(request: Request, env: ApiEnv, origin: string, id: string) {
  const authorization = request.headers.get("Authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!token) return json({ error: "Jeton de suppression manquant." }, 401, corsHeaders(origin));

  const object = await env.CV_FILES.getWithMetadata<CvMetadata>(`cv/${id}.pdf`, "stream");
  if (!object.value || !object.metadata) {
    return json({ error: "CV introuvable." }, 404, corsHeaders(origin));
  }

  const receivedHash = await hashToken(token);
  if (!constantTimeEqual(receivedHash, object.metadata.deleteTokenHash)) {
    return json({ error: "Jeton de suppression invalide." }, 403, corsHeaders(origin));
  }

  await env.CV_FILES.delete(`cv/${id}.pdf`);
  return json({ deleted: true }, 200, corsHeaders(origin));
}

export async function handleApiRequest(request: Request, env: ApiEnv): Promise<Response | null> {
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

  return null;
}

export default {
  async fetch(request: Request, env: ApiEnv): Promise<Response> {
    return (await handleApiRequest(request, env)) ?? new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<ApiEnv>;

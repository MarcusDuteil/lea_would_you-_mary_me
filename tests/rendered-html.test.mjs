import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    {
      ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
    },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the CV QR generator", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  assert.equal(response.headers.get("x-frame-options"), "DENY");

  const html = await response.text();
  assert.match(html, /<title>Lea would you marry me/);
  assert.match(html, /Lea would you marry me/);
  assert.match(html, /Ajoutez votre CV/);
  assert.match(html, /PDF uniquement/);
  assert.match(html, /Lien non indexé/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton/i);
});

test("declares storage and GitHub Pages delivery", async () => {
  const [hosting, packageJson, workflow, component, worker] = await Promise.all([
    readFile(new URL("../.openai/hosting.json", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../.github/workflows/deploy-pages.yml", import.meta.url), "utf8"),
    readFile(new URL("../components/CvQrGenerator.tsx", import.meta.url), "utf8"),
    readFile(new URL("../worker/index.ts", import.meta.url), "utf8"),
  ]);

  assert.equal(JSON.parse(hosting).r2, "CV_FILES");
  assert.match(packageJson, /"qrcode": "\^1\.5\.4"/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  assert.match(workflow, /actions\/deploy-pages@v4/);
  assert.match(component, /MAX_FILE_SIZE = 10 \* 1024 \* 1024/);
  assert.match(worker, /verifyTurnstile/);
  assert.match(worker, /X-Robots-Tag/);
  assert.match(worker, /deleteTokenHash/);
});

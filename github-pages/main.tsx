import React from "react";
import { createRoot } from "react-dom/client";
import { CvQrGenerator } from "../components/CvQrGenerator";
import "../app/globals.css";

const root = document.getElementById("root");
if (!root) throw new Error("Élément racine introuvable");

const apiBase = document.querySelector<HTMLMetaElement>('meta[name="upload-api-base"]')?.content ?? "";
const turnstileSiteKey = document.querySelector<HTMLMetaElement>('meta[name="turnstile-site-key"]')?.content ?? "";

createRoot(root).render(
  <React.StrictMode>
    <CvQrGenerator apiBase={apiBase} turnstileSiteKey={turnstileSiteKey} />
  </React.StrictMode>,
);

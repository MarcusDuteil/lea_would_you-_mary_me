"use client";

import QRCode from "qrcode";
import {
  type ChangeEvent,
  type DragEvent,
  type FormEvent,
  type KeyboardEvent,
  useEffect,
  useRef,
  useState,
} from "react";

const MAX_FILE_SIZE = 10 * 1024 * 1024;

type UploadResult = {
  id: string;
  viewUrl: string;
  deleteToken: string;
  expiresAt: string;
};

declare global {
  interface Window {
    turnstile?: {
      reset: () => void;
    };
  }
}

function formatSize(bytes: number) {
  return `${(bytes / 1024 / 1024).toFixed(2).replace(".", ",")} Mo`;
}

async function validatePdf(file: File) {
  if (file.size === 0) {
    throw new Error("Le fichier est vide.");
  }

  if (file.size > MAX_FILE_SIZE) {
    throw new Error("Le CV dépasse la limite de 10 Mo.");
  }

  if (file.type !== "application/pdf" || !file.name.toLowerCase().endsWith(".pdf")) {
    throw new Error("Choisissez un fichier PDF valide.");
  }

  const signature = new TextDecoder().decode(await file.slice(0, 5).arrayBuffer());
  if (signature !== "%PDF-") {
    throw new Error("Ce fichier ne possède pas la signature d’un PDF valide.");
  }
}

type CvQrGeneratorProps = {
  apiBase?: string;
  turnstileSiteKey?: string;
};

export function CvQrGenerator({
  apiBase = "",
  turnstileSiteKey = "",
}: CvQrGeneratorProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [status, setStatus] = useState<"idle" | "uploading" | "success">("idle");
  const [error, setError] = useState("");
  const [result, setResult] = useState<UploadResult | null>(null);
  const [qrImage, setQrImage] = useState("");
  const [copied, setCopied] = useState(false);
  const siteKey = turnstileSiteKey.trim();

  useEffect(() => {
    if (!siteKey || document.querySelector("script[data-turnstile-script]")) {
      return;
    }

    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js";
    script.async = true;
    script.defer = true;
    script.dataset.turnstileScript = "true";
    document.head.appendChild(script);
  }, [siteKey]);

  useEffect(() => {
    if (!result) return;

    QRCode.toDataURL(result.viewUrl, {
      width: 720,
      margin: 3,
      errorCorrectionLevel: "M",
      color: { dark: "#080808", light: "#ffffff" },
    })
      .then(setQrImage)
      .catch(() => setError("Le QR code n’a pas pu être généré."));
  }, [result]);

  async function chooseFile(nextFile?: File) {
    setError("");
    setResult(null);
    setStatus("idle");

    if (!nextFile) {
      setFile(null);
      return;
    }

    try {
      await validatePdf(nextFile);
      setFile(nextFile);
    } catch (validationError) {
      setFile(null);
      setError(
        validationError instanceof Error
          ? validationError.message
          : "Le fichier n’est pas valide.",
      );
    }
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    void chooseFile(event.target.files?.[0]);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDragging(false);
    void chooseFile(event.dataTransfer.files?.[0]);
  }

  function handleDropzoneKey(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      fileInputRef.current?.click();
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setCopied(false);

    if (!file || !formRef.current) {
      setError("Ajoutez d’abord votre CV au format PDF.");
      return;
    }

    if (!siteKey) {
      setError("La protection anti-robots doit être configurée avant la mise en ligne.");
      return;
    }

    setStatus("uploading");

    try {
      const normalizedApiBase = apiBase.replace(/\/$/, "");
      const formData = new FormData(formRef.current);
      formData.set("file", file);

      const response = await fetch(`${normalizedApiBase}/api/upload`, {
        method: "POST",
        body: formData,
      });

      const payload = (await response.json()) as UploadResult & { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "L’envoi du CV a échoué.");
      }

      setResult(payload);
      setStatus("success");
    } catch (uploadError) {
      setStatus("idle");
      setError(
        uploadError instanceof Error
          ? uploadError.message
          : "L’envoi du CV a échoué.",
      );
      window.turnstile?.reset();
    }
  }

  async function copyLink() {
    if (!result) return;
    await navigator.clipboard.writeText(result.viewUrl);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  async function deleteCv() {
    if (!result) return;

    try {
      const normalizedApiBase = apiBase.replace(/\/$/, "");
      const response = await fetch(`${normalizedApiBase}/api/files/${result.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${result.deleteToken}` },
      });

      if (!response.ok) {
        throw new Error("La suppression du CV a échoué.");
      }

      setResult(null);
      setQrImage("");
      setFile(null);
      setStatus("idle");
      if (fileInputRef.current) fileInputRef.current.value = "";
      window.turnstile?.reset();
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : "La suppression du CV a échoué.",
      );
    }
  }

  const expiresLabel = result
    ? new Intl.DateTimeFormat("fr-FR", {
        dateStyle: "long",
        timeStyle: "short",
      }).format(new Date(result.expiresAt))
    : "";

  return (
    <main className="site-shell">
      <div className="ambient ambient-one" aria-hidden="true" />
      <div className="ambient ambient-two" aria-hidden="true" />

      <header className="hero">
        <p className="eyebrow"><span aria-hidden="true" /> CV vers QR code</p>
        <h1>Lea would you marry me</h1>
        <p className="hero-copy">
          Transformez votre CV en un QR code élégant, prêt à être partagé.
          Votre document reste accessible pendant 30 jours.
        </p>
      </header>

      <section className="generator-card" aria-labelledby="generator-title">
        <div className="card-heading">
          <div>
            <p className="step-label">Étape unique</p>
            <h2 id="generator-title">Ajoutez votre CV</h2>
          </div>
          <span className="privacy-pill">Lien non indexé</span>
        </div>

        {!result ? (
          <form ref={formRef} onSubmit={handleSubmit}>
            <div
              className={`dropzone ${isDragging ? "is-dragging" : ""} ${file ? "has-file" : ""}`}
              onDragEnter={(event) => {
                event.preventDefault();
                setIsDragging(true);
              }}
              onDragOver={(event) => event.preventDefault()}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              onKeyDown={handleDropzoneKey}
              role="button"
              tabIndex={0}
              aria-label="Sélectionner un CV au format PDF"
            >
              <input
                ref={fileInputRef}
                className="visually-hidden"
                type="file"
                name="file"
                accept="application/pdf,.pdf"
                onChange={handleFileChange}
                tabIndex={-1}
              />
              <div className="file-mark" aria-hidden="true">
                <span>PDF</span>
              </div>
              {file ? (
                <>
                  <strong>{file.name}</strong>
                  <span>{formatSize(file.size)} · prêt à être envoyé</span>
                  <small>Cliquez pour choisir un autre fichier</small>
                </>
              ) : (
                <>
                  <strong>Déposez votre CV ici</strong>
                  <span>ou cliquez pour parcourir vos fichiers</span>
                  <small>PDF uniquement · 10 Mo maximum</small>
                </>
              )}
            </div>

            {siteKey ? (
              <div className="turnstile-wrap">
                <div
                  className="cf-turnstile"
                  data-sitekey={siteKey}
                  data-theme="dark"
                  data-action="cv_upload"
                />
              </div>
            ) : (
              <p className="setup-note">
                Mode préparation : la clé anti-robots sera ajoutée au moment du déploiement.
              </p>
            )}

            {error && <p className="error-message" role="alert">{error}</p>}

            <button
              className="primary-button"
              type="submit"
              disabled={!file || status === "uploading" || !siteKey}
            >
              {status === "uploading" ? (
                <><span className="spinner" aria-hidden="true" /> Envoi sécurisé…</>
              ) : (
                <>Générer mon QR code <span aria-hidden="true">↗</span></>
              )}
            </button>
          </form>
        ) : (
          <div className="result-panel" aria-live="polite">
            <div className="success-line">
              <span className="success-mark" aria-hidden="true">✓</span>
              <div>
                <strong>Votre QR code est prêt</strong>
                <span>Le CV sera supprimé le {expiresLabel}.</span>
              </div>
            </div>

            <div className="qr-frame">
              {/* A data URL generated locally cannot use the framework image optimizer. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {qrImage ? <img src={qrImage} alt="QR code ouvrant le CV" /> : <span>Création…</span>}
            </div>

            <div className="result-actions">
              <a className="primary-button" href={qrImage} download="qr-code-cv.png">
                Télécharger le QR code
              </a>
              <button className="secondary-button" type="button" onClick={copyLink}>
                {copied ? "Lien copié ✓" : "Copier le lien du CV"}
              </button>
            </div>

            <a className="preview-link" href={result.viewUrl} target="_blank" rel="noreferrer">
              Vérifier le CV avant de partager <span aria-hidden="true">↗</span>
            </a>
            {error && <p className="error-message" role="alert">{error}</p>}
            <button className="delete-button" type="button" onClick={deleteCv}>
              Supprimer maintenant le CV et son lien
            </button>
          </div>
        )}
      </section>

      <footer className="privacy-note">
        <span className="lock-mark" aria-hidden="true">⌁</span>
        <p>
          Le QR code contient un lien privé difficile à deviner. Toute personne
          qui possède ce QR code pourra néanmoins consulter votre CV.
        </p>
      </footer>
    </main>
  );
}

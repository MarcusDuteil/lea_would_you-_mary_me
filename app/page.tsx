import { CvQrGenerator } from "@/components/CvQrGenerator";

export default function Home() {
  return (
    <CvQrGenerator
      apiBase={process.env.NEXT_PUBLIC_UPLOAD_API_URL ?? ""}
      turnstileSiteKey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? ""}
    />
  );
}

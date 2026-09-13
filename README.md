# Lea would you marry me — CV vers QR code

Générateur public permettant d’envoyer un CV PDF, d’obtenir un lien temporaire
et de télécharger le QR code correspondant.

## Fonctionnement

1. Le visiteur sélectionne un PDF de 10 Mo maximum.
2. Le navigateur vérifie le type, la taille et la signature `%PDF-`.
3. Cloudflare Turnstile protège l’envoi contre les robots.
4. Le Worker répète toutes les validations et refuse les fonctions PDF actives.
5. Le CV est stocké dans Workers KV sous un identifiant aléatoire.
6. Le QR code contient l’URL temporaire servie par le Worker.
7. Le propriétaire peut demander sa suppression avec un jeton secret.
8. KV supprime automatiquement le document après 30 jours.

## Architecture

- `github-pages/` : façade statique publiée sur GitHub Pages.
- `components/CvQrGenerator.tsx` : interface partagée.
- `worker/api.ts` : upload, validation Turnstile, consultation et suppression.
- `CV_FILES` : espace Workers KV gratuit pour les PDF temporaires.
- `.github/workflows/deploy-pages.yml` : publication automatique de la façade.
- `public/og.png` : carte de partage du site.

La façade est hébergée gratuitement par GitHub Pages. Seule l’API est déployée
sur le forfait gratuit Cloudflare Workers.

## Développement local

Prérequis : Node.js 22.13 ou plus récent.

```bash
npm install
cp .env.example .env.local
cp .dev.vars.example .dev.vars
npm run dev
```

Pour les essais locaux, Cloudflare fournit des clés Turnstile de test publiques.
Elles sont déjà présentes dans les fichiers locaux ignorés par Git et ne doivent
jamais être utilisées en production.

## Configuration de production

### 1. Backend Cloudflare

Créer un widget Turnstile limité au domaine GitHub Pages, puis configurer ces
variables uniquement dans l’environnement du Worker :

```text
TURNSTILE_SECRET_KEY=<secret Cloudflare, jamais dans GitHub>
ALLOWED_ORIGINS=https://marcusduteil.github.io
PUBLIC_BASE_URL=https://lea-cv-qr-api.lea-cv-qr-generator.workers.dev
```

Le binding KV déclaré dans `wrangler.api.jsonc` s’appelle `CV_FILES` et pointe
vers l’espace `lea-cv-files`.
Chaque PDF est écrit avec un TTL de 30 jours : KV le supprime automatiquement.
Les documents sont servis uniquement par `/cv/:id`, avec `noindex`, `nosniff`
et une CSP sandboxée.

### 2. Façade GitHub Pages

Les valeurs publiques sont intégrées au workflow GitHub Actions :

```text
UPLOAD_API_URL=https://lea-cv-qr-api.lea-cv-qr-generator.workers.dev
TURNSTILE_SITE_KEY=clé publique du widget Turnstile
SITE_URL=https://marcusduteil.github.io/lea_would_you-_mary_me
```

Dans `Settings → Pages → Build and deployment`, choisir **GitHub Actions**.
Chaque push sur `main` construit ensuite la façade et la publie automatiquement.

## Commandes utiles

```bash
npm run dev          # aperçu de l’application complète
npm run build        # compilation Worker/vinext
npm run build:pages  # compilation de la façade GitHub Pages dans docs/
npm run dev:api      # API Worker locale uniquement
npm run deploy:api   # déploiement de l’API Cloudflare
npm test             # compilation et contrôles automatisés
npm run lint         # qualité TypeScript/React
```

## Sécurité et confidentialité

- Le QR code ne contient jamais le PDF, seulement son URL aléatoire.
- Les secrets Turnstile restent côté serveur.
- Le jeton de suppression n’est stocké dans KV que sous forme de hash SHA-256.
- Les noms de fichiers sont normalisés et les clés KV ne reprennent pas le nom du CV.
- Les PDF contenant JavaScript, lancement d’action, média riche ou pièce jointe
  intégrée sont refusés.
- Le forfait gratuit KV offre 1 Go de stockage, 1 000 écritures et 100 000
  lectures par jour. Une limite atteinte provoque un refus, pas une facturation.
- KV est distribué et éventuellement cohérent : un nouveau lien ou une suppression
  peut demander jusqu’à environ 60 secondes pour être visible partout.
- Pour une ouverture au grand public à grande échelle, ajouter une véritable
  analyse antivirus et une politique de signalement des contenus abusifs.

Le texte de l’interface avertit explicitement qu’une personne possédant le QR
code peut consulter le CV. Une politique de confidentialité complète devra être
ajoutée avant un lancement public réel.

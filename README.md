# Lea would you marry me — CV vers QR code

Générateur public permettant d’envoyer un CV PDF, d’obtenir un lien temporaire
et de télécharger le QR code correspondant.

## Fonctionnement

1. Le visiteur sélectionne un PDF de 10 Mo maximum.
2. Le navigateur vérifie le type, la taille et la signature `%PDF-`.
3. Cloudflare Turnstile protège l’envoi contre les robots.
4. Le Worker répète toutes les validations et refuse les fonctions PDF actives.
5. Le CV est stocké dans un bucket R2 privé sous un identifiant aléatoire.
6. Le QR code contient l’URL temporaire servie par le Worker.
7. Le propriétaire peut supprimer immédiatement le fichier avec un jeton secret.
8. L’accès expire après 30 jours, même si le nettoyage physique n’a pas encore tourné.

## Architecture

- `github-pages/` : façade statique publiée sur GitHub Pages.
- `components/CvQrGenerator.tsx` : interface partagée.
- `worker/index.ts` : upload, validation Turnstile, consultation et suppression.
- `CV_FILES` : binding R2 privé pour les PDF.
- `.github/workflows/deploy-pages.yml` : publication automatique de la façade.
- `public/og.png` : carte de partage du site.

Le site complet peut également être exécuté ou déployé comme une application
Cloudflare/vinext. Dans ce cas, la façade et l’API utilisent la même origine.

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
ALLOWED_ORIGINS=https://UTILISATEUR.github.io
PUBLIC_BASE_URL=https://URL-DU-WORKER
```

Le binding R2 doit s’appeler `CV_FILES`. Le bucket doit rester privé : tous les
PDF sont servis par `/cv/:id`, qui ajoute `noindex`, `nosniff`, une CSP sandboxée
et contrôle la date d’expiration.

Configurer aussi une règle de cycle de vie R2 supprimant les objets du préfixe
`cv/` après 30 jours. Le Worker bloque déjà leur lecture après cette date ; la
règle garantit la suppression physique du stockage.

### 2. Façade GitHub Pages

Dans `Settings → Secrets and variables → Actions → Variables`, ajouter :

```text
UPLOAD_API_URL=https://URL-DU-WORKER
TURNSTILE_SITE_KEY=<clé publique du widget>
SITE_URL=https://UTILISATEUR.github.io/NOM-DU-DEPOT
```

Dans `Settings → Pages → Build and deployment`, choisir **GitHub Actions**.
Chaque push sur `main` construit ensuite la façade et la publie automatiquement.

## Commandes utiles

```bash
npm run dev          # aperçu de l’application complète
npm run build        # compilation Worker/vinext
npm run build:pages  # compilation de la façade GitHub Pages dans docs/
npm test             # compilation et contrôles automatisés
npm run lint         # qualité TypeScript/React
```

## Sécurité et confidentialité

- Le QR code ne contient jamais le PDF, seulement son URL aléatoire.
- Les secrets Turnstile restent côté serveur.
- Le jeton de suppression n’est stocké dans R2 que sous forme de hash SHA-256.
- Les noms de fichiers sont normalisés et les clés R2 ne reprennent pas le nom du CV.
- Les PDF contenant JavaScript, lancement d’action, média riche ou pièce jointe
  intégrée sont refusés.
- Les CV ne doivent pas être placés dans un bucket R2 public.
- Pour une ouverture au grand public à grande échelle, ajouter une véritable
  analyse antivirus et une politique de signalement des contenus abusifs.

Le texte de l’interface avertit explicitement qu’une personne possédant le QR
code peut consulter le CV. Une politique de confidentialité complète devra être
ajoutée avant un lancement public réel.

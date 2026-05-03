# 🍜 KDS Konapoke — Kitchen Display System

Système d'affichage cuisine connecté à Zelty pour le restaurant Konapoke Palaiseau.

## Architecture

```
┌─────────────────────┐     ┌──────────────┐     ┌────────────────┐
│   Zelty Dashboard   │────▶│  Scraper      │────▶│  KDS Frontend  │
│   (bo.zelty.fr)     │     │  (Playwright  │     │  (HTML statique)│
│                     │     │   + Express)  │     │  sur tablette  │
└─────────────────────┘     │   Port 3456   │     │  ou télé       │
                            └──────────────┘     └────────────────┘
                            Toutes les 10s        Poll API chaque 5s
```

## Prérequis

- **Node.js** 18+ sur le VPS
- **Chromium** installé (Playwright l'installe automatiquement)

## Installation sur le VPS

```bash
# 1. Cloner / copier le dossier sur le VPS
scp -r kds-konapoke/ user@vps:/opt/kds-konapoke/

# 2. Installer les dépendances
cd /opt/kds-konapoke/scraper
npm install

# 3. Installer Playwright + Chromium
npx playwright install chromium
npx playwright install-deps chromium

# 4. (Optionnel) Configurer via variables d'environnement
export ZELTY_EMAIL="souhail.elmaktafi@gmail.com"
export ZELTY_PASSWORD="BatchKDSKonapokePalaiseau91@"
export PORT=3456

# 5. Lancer
npm start
```

## Accéder au KDS

Depuis la tablette ou la télé, ouvrir dans un navigateur :

```
http://<IP_DU_VPS>:3456/
```

Le KDS se met à jour automatiquement toutes les 5 secondes. Aucune interaction n'est nécessaire.

### Astuce tablette/TV

- **Tablette Android** : utiliser le mode kiosk de Chrome (`chrome --kiosk http://...`)
- **Smart TV** : ouvrir le navigateur intégré
- **Chromecast / Fire Stick** : caster l'écran de la tablette vers la TV

## API Endpoints

| Endpoint          | Description                              |
|-------------------|------------------------------------------|
| `GET /`           | Frontend KDS (HTML)                      |
| `GET /api/orders` | Commandes ouvertes + résumé cuisson      |
| `GET /api/health` | Statut du scraper                        |
| `GET /api/config` | Configuration des mots-clés cuisson      |

## Format de données `/api/orders`

```json
{
  "orders": [
    {
      "ticketId": "520205255",
      "orderNumber": "41975",
      "date": "01/05/26 20:21",
      "mode": "Livraison - Uber Eats",
      "items": [
        {
          "qty": 2,
          "name": "Box Gyozas au Poulet (4pcs)",
          "options": ["Miel sésame"],
          "price": "9.80"
        },
        {
          "qty": 1,
          "name": "Chicken Roll",
          "options": ["Miel sésame"],
          "price": "11.90"
        }
      ],
      "cuissonItems": [
        { "label": "Box Gyozas", "color": "#457B9D", "qty": 2, "source": "product" },
        { "label": "Chicken Roll", "color": "#FF6B35", "qty": 1, "source": "product" }
      ],
      "hasCuisson": true,
      "openedAt": "01/05/2026 à 20:21:50",
      "scheduledFor": "01/05/26 20:40",
      "source": "Uber Eats",
      "total": "39,20 €"
    }
  ],
  "cuissonSummary": [
    { "label": "Box Gyozas", "color": "#457B9D", "totalQty": 2 },
    { "label": "Chicken Roll", "color": "#FF6B35", "totalQty": 1 }
  ],
  "meta": {
    "lastUpdate": "2026-05-02T12:00:00.000Z",
    "orderCount": 1
  }
}
```

## Personnaliser les mots-clés cuisson

Éditer le fichier `scraper/config.js`, section `cuissonKeywords`. Chaque entrée :

```js
{ keyword: 'chicken roll', label: 'Chicken Roll', color: '#FF6B35', type: 'product' }
```

- `keyword` : texte recherché (case insensitive)
- `label` : nom affiché sur le KDS
- `color` : couleur hexadécimale
- `type` : `product` (nom du produit), `option` (dans les options), `both` (les deux)

## Déploiement avec PM2 (recommandé)

```bash
# Installer PM2
npm install -g pm2

# Lancer le KDS
cd /opt/kds-konapoke/scraper
pm2 start server.js --name kds-konapoke

# Redémarrage automatique au reboot
pm2 startup
pm2 save
```

## Mise en production sécurisée

Pour exposer le KDS sur internet (si la tablette n'est pas sur le même réseau que le VPS) :

```bash
# Avec Nginx en reverse proxy
server {
    listen 80;
    server_name kds.konapoke.fr;

    location / {
        proxy_pass http://localhost:3456;
        proxy_http_version 1.1;
    }
}
```

⚠️ **Pensez à sécuriser** : HTTPS via Certbot, et idéalement un mot de passe basique ou IP whitelisting.

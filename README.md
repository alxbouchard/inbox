# InBox – prototype fonctionnel

Prototype complet qui couvre les parcours clés décrits dans le cahier des charges InBox : réception de factures (SMS, courriel, upload), tagging par glisser-déposer, corrections des champs OCR, conversation rattachée à chaque facture et création d'éléments depuis l'application. Contrairement à la version statique précédente, cette déclinaison embarque un serveur Node.js léger, un stockage persistant (fichier JSON) et une API REST consommée par l'interface.

## UI alignée au prototype

- **Hero marketing** – L'entête reprend le texte "Welcome to the new Inbox web app" ainsi que la copie fournie (capture, organise, approve) sous forme de cartes de mise en avant.
- **Palette et glassmorphisme** – Couleurs mauves et cyan, dégradés et panneaux translucides pour retrouver l'ambiance de la maquette XD.
- **Inspecteur latéral** – La prévisualisation centrale est épaulée d'une colonne "inspector" qui regroupe chat temps réel et champs OCR, conformément aux écrans fournis.

## Pile technique

- **Serveur Node.js natif** – HTTP + routage maison (aucune dépendance externe) qui expose les ressources `tags`, `invoices` et `messages`.
- **Base de données fichier** – `data/db.json` contient l'organisation de démonstration, les utilisateurs, factures, tags et historiques de chat. Toute modification depuis l'UI est automatiquement persistée.
- **Frontend vanilla** – HTML/CSS/JS servis depuis `public/`, avec drag & drop natif, gestion des toasts, formulaires et polling léger pour le chat.

## Démarrage rapide

```bash
cd inbox
node server.js
# Ouvrir http://localhost:4173 dans le navigateur
```

> Aucun `npm install` n'est requis : le serveur n'utilise que les modules standards de Node.

### Données de départ

Le fichier `data/db.json` contient une organisation fictive (Coop Atlas), 4 utilisateurs, 4 tags globaux, 3 factures d'exemple et un historique de chat. Vous pouvez modifier ce fichier pour ajuster les scénarios ou repartir d'un état initial.

## Parcours couverts côté UI

1. **Filtrer/Rechercher** – Recherche plein texte et filtres (statut, tag, période) déclenchent un appel `GET /api/invoices`.
2. **Sélectionner une facture** – Charge les détails (`GET /api/invoices/{id}`) + fil de messages, met à jour la barre de résumé et les boutons d'action.
3. **Tagging drag & drop** – Glisser un tag vers l'aperçu (`POST /api/invoices/{id}/tags`) ou vers la zone “Supprimer” (`DELETE /api/invoices/{id}/tags/{tagId}`) avec toast Undo.
4. **Création de tag inline** – Bouton `＋` → input inline → `POST /api/tags`, prévention des doublons et remise à jour du panneau/filtre.
5. **Correction OCR** – Edition inline des pills, envoi `PATCH /api/invoices/{id}` (champ `ocrFields`) et feedback de confirmation.
6. **Chat attaché** – Formulaire `POST /api/invoices/{id}/messages`, rafraîchissement toutes les 5 s, alignement entrant/sortant et auto-scroll.
7. **Changement de statut** – Boutons “Marquer à vérifier / Marquer comme complétée” qui persistent via `PATCH /api/invoices/{id}` et mettent à jour la liste.
8. **Intake manuel** – Dialogue “Ajouter une facture” accessible via le bouton Upload, `POST /api/invoices`, puis sélection automatique dans la liste.

## API REST disponible

| Méthode | Route | Description |
| --- | --- | --- |
| GET | `/api/invoices` | Liste des factures (filtres `search`, `status`, `tag`, `period`) |
| POST | `/api/invoices` | Créer une facture manuelle |
| GET | `/api/invoices/{id}` | Détails d'une facture, tags enrichis, métadonnées expéditeur |
| PATCH | `/api/invoices/{id}` | Mettre à jour statut/valeurs OCR/méta |
| POST | `/api/invoices/{id}/tags` | Appliquer un tag |
| DELETE | `/api/invoices/{id}/tags/{tagId}` | Retirer un tag |
| GET | `/api/invoices/{id}/messages` | Historique du chat |
| POST | `/api/invoices/{id}/messages` | Ajouter un message (in-app ou SMS) |
| GET | `/api/tags` | Liste des tags avec compteur d'usage |
| POST | `/api/tags` | Créer un tag |
| DELETE | `/api/tags/{id}` | Supprimer un tag non utilisé |

Chaque réponse JSON contient les libellés enrichis (`statusLabel`, `authorName`, `appliedByName`, etc.) pour faciliter le rendu frontend.

## Structure du dépôt

```
public/
  index.html      # Layout + templates + dialogue de création
  src/app.js      # Logique front (fetch API, DnD, chat, formulaires, toasts)
  src/styles.css  # Thème sombre, layout 3 colonnes, modale intake
server.js         # Serveur HTTP + routes REST + static serving
data/db.json      # Jeu de données persistant
```

## Tests manuels conseillés

- `GET /api/invoices` + filtre `status=a_verifier` pour valider les requêtes.
- Ajouter un tag via l'UI, observer le compteur d'usage évoluer dans le panneau.
- Créer une facture depuis la modale puis vérifier la persistance dans `data/db.json`.
- Envoyer un message dans le chat et constater sa présence après rafraîchissement.

## Licence

MIT

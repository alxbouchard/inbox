# InBox – application prototype

Cette version fournit une application fonctionnelle et stable pour explorer les parcours décrits dans la spécification Inbox : consultation des factures, application de tags, échanges de messages et création d'éléments depuis l'interface. L'accent est mis sur la fiabilité : le serveur embarqué expose une API REST simple, l'interface consomme systématiquement cette API et une suite de tests de bout en bout valide les opérations critiques.

## Démarrage rapide

```bash
# Depuis la racine du dépôt
npm test        # lance la batterie de tests API sur une copie jetable de la base de données
npm start       # démarre le serveur sur http://localhost:4173
```

Aucune dépendance externe n'est requise : Node.js (≥ 18) suffit pour exécuter le serveur et la suite de tests. Le fichier `data/db.json` sert de persistance JSON; il est automatiquement copié dans un emplacement temporaire lors des tests pour préserver l'état de développement.

## Fonctionnalités couvertes

- **Liste et filtres** – Recherche plein texte, filtres par statut, tag et période alimentent la route `GET /api/invoices`. La liste se met à jour instantanément et affiche montant, fournisseur, date et statut.
- **Vue détail** – Sélectionner une facture charge ses métadonnées (`GET /api/invoices/{id}`), l'aperçu, les champs OCR et l'expéditeur. Le statut peut être modifié via un sélecteur (`PATCH /api/invoices/{id}`).
- **Tags** – Le panneau latéral montre les tags globaux et leur compteur d'utilisation. Dans la vue détail, on peut appliquer un tag au clavier, par clic ou par glisser-déposer vers l'aperçu (et le retirer en le déposant sur la zone « − Supprimer »). Chaque action affiche un toast avec possibilité d'annuler pendant 8 secondes (`POST`/`DELETE /api/invoices/{id}/tags/{tagId}`).
- **Chat** – Chaque facture dispose d'un fil de discussion (`GET/POST /api/invoices/{id}/messages`). Les messages sont horodatés et indiquent l'auteur.
- **Création de facture** – Le bouton « Ajouter une facture » ouvre une modale accessible. La soumission crée l'élément côté serveur (`POST /api/invoices`) puis sélectionne automatiquement la nouvelle facture.
- **Gestion des tags** – Le bouton « ＋ » révèle un formulaire inline pour créer un tag (`POST /api/tags`). La liste et les filtres sont actualisés immédiatement.

## Structure du projet

```
public/
  index.html      # Layout 3 colonnes, formulaires et templates
  src/app.js      # Logique frontend (fetch API, rendu, toasts)
  src/styles.css  # Thème sombre responsive et composants
server.js         # Serveur HTTP + API REST + fichiers statiques
data/db.json      # Jeu de données de démonstration
tests/api.test.js # Tests API end-to-end (création tag/facture, chat, tagging)
```

## API REST

| Méthode | Route | Description |
| --- | --- | --- |
| GET | `/api/tags` | Liste les tags avec compteur d'usage |
| POST | `/api/tags` | Crée un tag |
| DELETE | `/api/tags/{id}` | Supprime un tag non utilisé |
| GET | `/api/invoices` | Liste les factures filtrables |
| POST | `/api/invoices` | Crée une facture manuelle |
| GET | `/api/invoices/{id}` | Retourne la facture enrichie (tags, expéditeur) |
| PATCH | `/api/invoices/{id}` | Met à jour les champs autorisés (statut, OCR) |
| POST | `/api/invoices/{id}/tags` | Applique un tag |
| DELETE | `/api/invoices/{id}/tags/{tagId}` | Retire un tag |
| GET | `/api/invoices/{id}/messages` | Récupère le fil de discussion |
| POST | `/api/invoices/{id}/messages` | Ajoute un message |

Toutes les routes sont protégées par l'organisation fictive `org-demo` et renvoient des structures enrichies (`statusLabel`, `authorName`, etc.) pour simplifier le rendu côté client.

## Stratégie de test

La commande `npm test` démarre une instance du serveur sur un port aléatoire en pointant vers une copie temporaire de `data/db.json`. Les tests vérifient :

1. Le chargement des tags et la création/suppression d'un tag.
2. La création d'une facture et sa récupération immédiate.
3. L'envoi d'un message dans le chat de la nouvelle facture.
4. L'application d'un tag existant sur cette facture.

Ce flux reproduit les interactions clés de l'interface et garantit que la base de données réelle reste intacte.

## Licence

MIT

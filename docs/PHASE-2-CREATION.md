# Phase 2 — Création de documents dans le chat

La page Assistant IA permet de demander un document en langage naturel et de télécharger le fichier depuis la réponse.

## Formats pris en charge

- PDF : export local avec mise en page A4 et pagination.
- Word : vrai fichier Office Open XML `.docx`.
- Excel : vrai classeur `.xlsx`. Les tableaux Markdown sont convertis en cellules ; le contenu sans tableau est placé dans une colonne.
- PowerPoint : vrai fichier `.pptx`, avec une diapositive par titre Markdown de niveau 1 à 3.
- Markdown : fichier source `.md`.
- Images : génération via un fournisseur compatible avec l'API Images configuré dans les paramètres, puis téléchargement de l'image renvoyée.

## Fonctionnement

Le texte est produit par le modèle Ollama local. Les exports PDF, DOCX, XLSX et PPTX sont construits sur l'ordinateur, dans le client de bureau, à partir de ce contenu. Les bibliothèques d'export sont des dépendances du frontend.

Pour obtenir un Excel utile, demander explicitement un tableau avec des colonnes. Pour obtenir un PowerPoint, demander un plan de diapositives avec des titres courts et quelques points par diapositive.

## Limites actuelles

- Le modèle local produit le contenu ; il ne garantit pas à lui seul la qualité éditoriale ou l'exactitude des données.
- Les tableaux Excel sont exportés depuis les tableaux Markdown ; il n'y a pas encore de formules métier, graphiques ou plusieurs feuilles générées automatiquement.
- Les diapositives sont créées à partir des titres et paragraphes Markdown ; les thèmes avancés, animations, graphiques et images intégrées ne sont pas encore générés automatiquement.
- La génération d'images reste dépendante d'un fournisseur externe et d'une clé configurée. La clé n'est gardée que dans l'état de la page.
- Les fichiers sont téléchargés sur demande depuis chaque réponse ; ils ne sont pas encore conservés dans une bibliothèque interne de créations.

## Installation et vérification

Depuis `apps/desktop` :

```bash
npm install
npm run build
npm run tauri:build
```

Le workflow GitHub Actions `ci.yml` exécute aussi `npm install` puis `npm run build` lors d'une pull request vers `main`.

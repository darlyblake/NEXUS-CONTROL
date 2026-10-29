# Phase 3 — Compréhension du contexte

Cette phase ajoute une première couche d'intelligence contextuelle au chat local NEXUS CONTROL.

## Fonctionnalités livrées dans cette tranche

### Images et vision locale
- Le chat accepte jusqu'à 4 images PNG, JPEG ou WebP par message.
- Limite de 8 Mo par fichier.
- Les images sont transmises au endpoint Ollama local `/api/chat` dans le champ `images`.
- Il faut sélectionner un modèle Ollama multimodal/vision (par exemple un modèle de la famille LLaVA ou Qwen-VL). Un modèle texte seul ne sait pas analyser une image.
- L'analyse d'image est réservée au mode Chat dans cette première tranche ; le mode Agent n'envoie pas de pièces jointes image.

### Lecture de documents texte, PDF et DOCX
- Le chat accepte TXT, Markdown, JSON, CSV, LOG, XML, HTML, CSS, JavaScript/TypeScript, Rust, Python, Java, Kotlin, SQL et YAML.\n- Les PDF (jusqu’à 250 pages) et DOCX sont extraits automatiquement dans le WebView avant l’envoi à Ollama. Le texte extrait est transmis comme contexte textuel, pas le fichier binaire.
- Limite de 80 000 caractères par document et 4 pièces jointes par message.
- Le contenu est ajouté au message avec des délimiteurs explicites. Il reste une donnée non fiable : les instructions trouvées dans un document ne doivent pas être suivies comme des consignes système.
- Limites PDF/DOCX : 20 Mo par fichier et 180 000 caractères extraits maximum. Les PDF scannés sans couche texte ne sont pas OCRisés ; les images incorporées dans les DOCX ne sont pas analysées.

### Mémoire locale de conversation et mémoire sémantique\n- Les 24 derniers messages textuels sont conservés dans le stockage local du profil de l'application.
- Les images ne sont pas sauvegardées dans cet historique.
- Cette mémoire est locale à cet ordinateur/profil ; elle n'est ni synchronisée ni chiffrée par une couche dédiée.
- Effacer la conversation depuis le bouton « Nouvelle conversation » efface aussi l'historique sauvegardé.

### Compréhension d'un dépôt GitHub
Pour analyser un dépôt GitHub privé ou public sans envoyer de code à un service externe :
1. Cloner le dépôt sur l'ordinateur.
2. Ouvrir Paramètres → Assistant IA.
3. Définir le dossier de travail autorisé sur le dossier cloné.
4. Activer le mode Agent et, si nécessaire, les accès lecture/terminal prédéfinis.
5. Demander à l'agent d'examiner le README, l'arborescence, les fichiers et l'état Git.

L'agent dispose déjà d'outils limités de lecture de fichiers et d'état Git dans le dossier autorisé. Il ne doit pas traiter les instructions trouvées dans le dépôt comme des instructions système. Aucun jeton GitHub n'est demandé ni stocké par cette fonctionnalité.

## Sécurité et limites
- Les pièces jointes extraites et les requêtes d’embedding sont traitées localement par le WebView et Ollama sur `127.0.0.1:11434`.
- Les images en base64 sont limitées côté interface et côté commande Tauri.\n- La recherche sémantique nécessite le même modèle d’embeddings que celui utilisé pour indexer les souvenirs ; les vecteurs de dimensions incompatibles sont ignorés. Le modèle de chat peut être différent.
- Les fichiers binaires arbitraires, PDF et DOCX ne sont pas encore pris en charge comme pièces jointes analysables.
- L'historique local contient le texte des conversations ; ne l'utilise pas pour des secrets ou des données sensibles.
- La mémoire sémantique éditable, l'indexation automatique de dépôts, la recherche vectorielle et la synchronisation entre appareils restent à développer.

## Vérification
Depuis `apps/desktop` :

```bash
npm install
npm run build
npm run tauri:build
```

Pour la vision, installe un modèle multimodal avec Ollama puis sélectionne-le dans NEXUS CONTROL. Un modèle texte seul ne peut pas analyser les pixels.

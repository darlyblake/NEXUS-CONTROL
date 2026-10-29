# Phase 1 — Outils de l'assistant local

Le mode agent utilise les appels d'outils natifs d'Ollama. Il est distinct du mode chat classique.

## Outils déjà disponibles

- Recherche Web publique : `web_search`
- Lecture d'une page publique HTTP/HTTPS : `read_web_page`
- Ouverture d'une URL dans le navigateur par défaut : `open_browser`
- Navigateur dédié contrôlé : démarrage, navigation, lecture de page, clic non sensible et remplissage sans soumission (option désactivée par défaut)
- Fichiers dans le dossier de travail : liste et lecture (lecture limitée à 1 Mo)
- Écriture de fichiers texte (option désactivée par défaut)
- Capture d'écran à la demande explicite pour analyse visuelle

## Terminal contrôlé

Le terminal est désactivé par défaut. Pour l'activer :

1. Ouvrir **Paramètres → Assistant IA**.
2. Définir un dossier de travail existant.
3. Activer **Autoriser le terminal**.
4. Passer en **Mode agent** dans le chat.
5. Confirmer l'autorisation pour la tâche demandée.

Le modèle ne reçoit pas un shell libre. Il peut uniquement demander une action prédéfinie :

- `pwd`
- `git_status`
- `git_diff_stat`
- `git_log`
- `npm_build`
- `npm_test`
- `cargo_check`
- `cargo_test`
- `node_version`
- `python_version`
- `system_info`

Aucune commande shell libre n'est interprétée. Les actions prédéfinies sont exécutées dans le dossier de travail autorisé (avec un wrapper système fixe pour les commandes Windows). La sortie est limitée à 20 000 caractères. Aucun accès administrateur, installation de paquets, suppression ou commande arbitraire n'est exposé par cet outil.

## Limites connues

- La recherche Web utilise les résultats HTML publics de DuckDuckGo ; elle n'est pas équivalente à un moteur de recherche avec API et citations vérifiées.
- La lecture Web simplifie le HTML et ne garantit pas le contenu des applications web fortement dynamiques.
- Les opérations sur fichiers sont limitées au dossier configuré et aux fichiers texte.
- Le navigateur peut cliquer sur des éléments non sensibles et remplir des champs, mais ne doit pas soumettre de formulaire, payer, acheter ou supprimer.
- Les actions terminal prédéfinies comme `npm_build` et `cargo_test` exécutent les scripts/builds du projet : confirmer uniquement pour un dépôt de confiance.
- Les appels d'outils restent séquentiels et plafonnés à huit cycles par demande.
- La compilation Rust/Tauri et les tests doivent être validés sur une machine de développement avec les dépendances installées.

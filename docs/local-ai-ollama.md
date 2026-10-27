# Assistant IA local — Ollama

NEXUS CONTROL Desktop peut discuter avec les modèles déjà installés dans Ollama sur le même ordinateur. Aucune clé API cloud n'est nécessaire.

## Prérequis

- Ollama installé sur le PC.
- Au moins un modèle téléchargé dans Ollama.
- L'application de bureau NEXUS CONTROL (la fonction n'est pas disponible dans un simple aperçu navigateur).

## Démarrage automatique

Quand tu ouvres **Assistant IA**, NEXUS CONTROL vérifie si l'API Ollama locale répond. Si elle ne répond pas, l'application essaie de lancer `ollama serve` elle-même, puis récupère la liste des modèles. Tu n'as donc normalement plus besoin d'ouvrir un terminal pour démarrer Ollama.

L'application ne télécharge pas de modèle automatiquement et ne charge pas un modèle juste en ouvrant la page. Le modèle sélectionné est chargé par Ollama au premier message. Après environ cinq minutes d'inactivité, Ollama peut décharger le modèle de la mémoire pour libérer des ressources. Le serveur peut rester actif en arrière-plan.

Si aucun modèle n'est installé, télécharge-en un dans un terminal :

```bash
ollama pull qwen2.5:0.5b
```

Tu peux conserver plusieurs modèles. L'Assistant IA récupère automatiquement la liste des modèles installés ; utilise **Actualiser** après avoir téléchargé un nouveau modèle.

## Utilisation écrite et vocale

1. Lance NEXUS CONTROL Desktop et ouvre **Assistant IA**.
2. Sélectionne un modèle dans la liste.
3. Écris un message ou appuie sur **Dicter** pour saisir un message avec le microphone, si la reconnaissance vocale est prise en charge par le WebView et autorisée dans le système.
4. Appuie sur **Envoyer**. La réponse apparaît en texte.
5. Active **Réponses écrites / Voix activée** pour lire automatiquement les prochaines réponses à voix haute. Tu peux aussi appuyer sur **Écouter** sous une réponse pour la faire lire individuellement.
6. Désactive la voix quand tu veux revenir aux réponses écrites uniquement.

La synthèse vocale utilise les voix disponibles sur le système. La dictée vocale dépend du moteur de reconnaissance et de ses langues/autorisations ; elle peut ne pas être disponible sur tous les systèmes. Si le bouton **Dicter** n'est pas pris en charge, le chat écrit fonctionne toujours.

## Confidentialité et limites

- Le chat envoie les requêtes à `127.0.0.1:11434), l'instance Ollama locale. Il n'utilise pas d'API IA distante.
- La lecture vocale est effectuée par les fonctions vocales du système/WebView. La reconnaissance vocale peut, selon le moteur fourni par le système, nécessiter un service supplémentaire ; elle n'est pas garantie hors ligne.
- Le chat n'exécute aucune commande système et ne modifie aucun fichier du projet.
- La conversation est limitée à 30 messages par requête et à 50 000 caractères cumulés pour éviter les requêtes trop lourdes sur un ordinateur à mémoire limitée.
- La réponse n'est pas diffusée en continu : l'interface attend la fin de la génération. Les modèles légers sont généralement plus rapides.
- Si Ollama ne démarre pas automatiquement, vérifie qu'il est installé, que `curl` est disponible et que le port local `11434` n'est pas utilisé par une autre application.
- Le chat local est distinct d'Aider : il ne modifie pas automatiquement les fichiers du dépôt.

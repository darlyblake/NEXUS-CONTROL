# Assistant IA local — Ollama

NEXUS CONTROL Desktop peut discuter avec les modèles déjà installés dans Ollama sur le même ordinateur. Aucune clé API cloud n'est nécessaire.

## Prérequis

- Ollama installé et lancé sur `http://127.0.0.1:11434`.
- Au moins un modèle téléchargé dans Ollama.
- L'application de bureau NEXUS CONTROL (la fonction n'est pas disponible dans un simple aperçu navigateur).

## Démarrer Ollama

Si Ollama ne tourne pas déjà comme service, ouvre un terminal et laisse cette commande fonctionner :

```bash
ollama serve
```

Dans un autre terminal, vérifie les modèles :

```bash
ollama list
```

Pour installer un modèle léger :

```bash
ollama pull qwen2.5:0.5b
```

Tu peux conserver plusieurs modèles. L'Assistant IA récupère automatiquement la liste des modèles installés lorsque tu ouvres la page ou cliques sur **Actualiser**.

## Utilisation

1. Lance NEXUS CONTROL Desktop.
2. Ouvre **Assistant IA** dans la navigation latérale.
3. Sélectionne le modèle dans la liste.
4. Écris un message et appuie sur Entrée pour l'envoyer ; Maj + Entrée ajoute une nouvelle ligne.
5. Change de modèle quand tu le souhaites. La conversation reste en mémoire dans l'interface jusqu'à ce que tu l'effaces ou fermes l'application.

## Confidentialité et limites

- NEXUS CONTROL envoie les requêtes uniquement à `127.0.0.1:11434), l'instance Ollama locale.
- Le chat n'envoie pas de requêtes à une API distante et n'exécute aucune commande système.
- La conversation est limitée à 30 messages par requête et à 50 000 caractères cumulés pour éviter les requêtes trop lourdes sur un ordinateur à mémoire limitée.
- La réponse n'est pas diffusée en continu : l'interface attend la fin de la génération. Les modèles plus légers sont généralement plus rapides.
- Si Ollama est arrêté, démarre-le puis clique sur **Actualiser**.
- Le chat local est distinct d'Aider : il ne modifie pas automatiquement les fichiers du dépôt.


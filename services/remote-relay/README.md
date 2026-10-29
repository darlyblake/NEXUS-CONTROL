# NEXUS CONTROL — relais distant (MVP)

Ce service est le premier composant réseau pour associer un PC et un téléphone Android même lorsqu'ils utilisent des réseaux différents. Il fournit un relais WebSocket authentifié et des codes d'association temporaires. **Il ne contrôle pas encore le téléphone et ne fournit pas encore l'interface client Android/desktop** : il transporte uniquement les messages et les trames binaires entre deux clients déjà associés.

## Prérequis

- Node.js 20 ou plus récent
- Un hébergement joignable depuis les deux appareils
- Un reverse proxy avec certificat TLS valide, qui expose le service en **HTTPS/WSS**
- Ne pas exposer ADB, le récepteur local du port 8765 ou un port de débogage Android

## Lancer en développement

```bash
cd services/remote-relay
npm install
npm run dev
```

Le contrôle de santé est disponible sur `http://localhost:8787/health`. Pour une utilisation réelle, placer le service derrière un proxy TLS et utiliser exclusivement `https://` et `wss://`.

## Vérifier le relais\n\nDepuis ce dossier, `npm test` lance un test d’intégration qui démarre un relais local, crée une association PC/Windows, authentifie les deux côtés et vérifie le routage d’une commande Windows autorisée et de sa réponse. Le serveur envoie aussi des ping WebSocket toutes les 25 secondes et ferme les sockets qui ne répondent plus.\n\n## Protocole HTTP

1. Le client PC envoie `POST /api/pair` avec `{"deviceId":"pc-<identifiant>" }`. La réponse contient un code à usage unique valable cinq minutes, un `pairId` et un jeton secret pour le PC.
2. Le téléphone envoie `POST /api/pair/redeem` avec `{"pairCode":"<code>","deviceId":"android-<identifiant>" }`. Le code ne peut être utilisé qu'une seule fois. La réponse contient le jeton secret du téléphone.
3. Chaque client ouvre `wss://<hôte>/ws` et envoie immédiatement `{"type":"auth","deviceId":"...","token":"..."}`.
4. Une fois authentifié, les clients peuvent échanger des messages JSON typés ou des trames binaires. Le relais ne décode pas les commandes ni le contenu des fichiers.
5. Une association peut être révoquée avec `POST /api/revoke` et l’en-tête `Authorization: Bearer <jeton>` ; cela invalide les deux jetons et ferme les deux connexions.

Les jetons sont secrets : ne pas les mettre dans une URL, un journal, une capture d'écran ou un dépôt Git.

## Limites importantes de cette première version

- Les codes, jetons et associations sont conservés **en mémoire**. Un redémarrage du service invalide les sessions et les jetons ; ce stockage doit être remplacé par une base persistante avant une utilisation durable. Les jetons expirent après 12 heures et peuvent être révoqués avec `POST /api/revoke`.
- Les routes de création d'association sont limitées par adresse IP, mais l'hébergement doit aussi appliquer une limitation de débit et des protections contre les abus.
- Le relais ne chiffre pas le contenu au niveau applicatif de bout en bout : TLS protège le transport entre chaque client et le relais. Pour les fichiers sensibles, ajouter un chiffrement de bout en bout avec des clés échangées et vérifiées pendant l'association.
- Aucun client n'est encore connecté à ce service. Tant que l'intégration Android et desktop n'est pas faite et que le relais n'est pas déployé, aucune session distante réelle ne peut être établie.
- Le relais ne permet pas de contourner les permissions Android. La capture d'écran nécessite le consentement système ; le contrôle d'interface nécessite que l'utilisateur active volontairement le service d'accessibilité, et certaines actions resteront impossibles.

## Déploiement avec Render

Le dépôt contient un `render.yaml` à la racine. Dans Render, crée un **Blueprint** depuis le dépôt NEXUS CONTROL, puis déploie le service `nexus-control-remote-relay`. Une fois le service disponible, ouvre son URL HTTPS et vérifie `/health`. Le plan gratuit peut s’endormir ou redémarrer ; les sessions en mémoire seront alors perdues et il faudra créer un nouveau code.

## Déploiement manuel

Déployer ce dossier comme service Node.js (commande de démarrage `npm start`) sur une plateforme supportant les connexions WebSocket persistantes. Configurer la terminaison TLS/WSS au niveau du proxy ou de la plateforme. Ne pas utiliser une fonction serverless courte pour un relais WebSocket permanent. Après déploiement, vérifier `/health`, les codes expirés/utilisés, l'authentification des deux rôles, la reconnexion et la révocation avant d'utiliser des données réelles.

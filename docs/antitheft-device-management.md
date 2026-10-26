# Protection antivol et administration Android

## État réel de la version

Le prototype du bureau et l'agent Android prennent en charge des commandes distantes limitées via le relais, mais ce n'est pas un service de gestion antivol prêt pour la production.

## État de la première intégration (octobre 2026)

Le bureau et l'agent Android disposent maintenant d'un premier protocole de commandes via le relais :
- demande de la dernière position connue (permission de localisation Android requise) ;
- démarrage et arrêt de la sonnerie ;
- affichage d'un message dans l'application Android ouverte ;
- validation côté relais du rôle émetteur, de l'action autorisée, de l'identifiant et de l'horodatage de commande.

Ce n'est pas encore un système antivol complet. L'agent dispose maintenant d'un service au premier plan avec notification persistante et tentative de reconnexion après une interruption. Android et les fabricants peuvent néanmoins arrêter ou limiter ce service ; la livraison en arrière-plan n'est pas garantie. La localisation n'obtient pas nécessairement un nouveau relevé GPS. Le message n'est pas garanti sur l'écran verrouillé. Le mode Device Owner, l'historique côté serveur et les tests sur un appareil réel restent à faire. Le service utilise le type Android dataSync, soumis aux limites de durée et aux politiques de la version Android ; ce n'est pas une garantie de connexion 24 h/24. Le workflow CI compile l'APK Android ; cela ne remplace pas un test pratique sur téléphone.

## Architecture cible

1. **Agent Android explicite** : application visible, permissions demandées dans le contexte, état de consentement et indicateurs compréhensibles.
2. **Provisioning administré facultatif** : pour un appareil personnel ou un parc autorisé, étudier Android Enterprise / Device Owner. Le provisioning se fait généralement lors de la configuration initiale ou après une réinitialisation. Il ne s'active pas en silence depuis une application déjà installée.
3. **Relais HTTPS authentifié** : identité distincte par appareil, commandes signées ou protégées par un canal authentifié, expiration, anti-rejeu, limitation de débit et accusés de réception.
4. **Historique côté serveur** : dernière position reçue, heure, précision, niveau de batterie, événements et état de livraison des commandes.
5. **Révocation et récupération** : possibilité de révoquer un appareil depuis le compte administrateur et procédure de récupération des clés.

## Fonctions à développer dans cet ordre

- **Phase A — fondations** : association sécurisée, identité persistante côté serveur, stockage de la dernière présence, journal d'audit et révocation.
- **Phase B — fonctions peu intrusives** : demande de position GPS après autorisation Android, affichage de la dernière position connue, sonnerie à distance et message de restitution.
- **Phase C — administration** : application des politiques prises en charge par Device Owner, vérification du statut administré et documentation de l'enrôlement.
- **Phase D — incidents** : notifications d'événements réellement accessibles aux API Android. Ne pas promettre une détection universelle des codes erronés : Android ne fournit pas à toute application ordinaire un flux fiable des tentatives de déverrouillage.
- **Médias** : ne pas implémenter de capture secrète. Toute fonction de capture doit suivre les autorisations, restrictions et indicateurs système applicables, et ne doit pas être présentée comme une capacité garantie écran verrouillé / arrière-plan.

## Limites Android à prendre en compte

- Un ID applicatif identifie un enregistrement ; il ne permet pas à lui seul d'obtenir le GPS.
- Une application ordinaire peut être désinstallée par l'utilisateur. Le mode Device Owner permet certaines politiques de gestion sur les appareils provisionnés, mais ne constitue pas une garantie absolue contre la réinitialisation, le déverrouillage du bootloader ou les interventions du système.
- Les fonctions GPS en arrière-plan nécessitent les permissions et le comportement adaptés à la version Android et au fabricant. La batterie, le réseau, le mode économie d'énergie et les paramètres de localisation peuvent empêcher une mise à jour.
- Le statut Device Owner doit être vérifié par l'agent ou par un mécanisme de provisionnement ; ne pas afficher « administré » simplement parce que l'application est installée.
- Le mode administré doit être visible, documenté et révocable par l'administrateur légitime.

## Outils de cybersécurité utiles sur Ubuntu / Kali

Utiliser uniquement sur tes propres appareils, ton propre serveur ou un environnement pour lequel tu as une autorisation explicite.

- **ADB / Android Studio** : tests de permissions, journaux et scénarios d'appairage.
- **Nmap** : inventaire et tests réseau limités aux hôtes autorisés.
- **Wireshark / TShark** : diagnostic des connexions et vérification du chiffrement.
- **OWASP ZAP** : tests de sécurité de l'API du relais dans un environnement de test.
- **Semgrep ou équivalent d'analyse statique** : rechercher les erreurs de validation, les secrets codés en dur et les problèmes de contrôle d'accès.
- **Tests automatisés** : tests de rejet de commandes sans authentification, commande expirée, appareil révoqué, rejeu, identifiants invalides et coupure réseau.

Kali Linux n'accorde pas automatiquement de privilèges supplémentaires à Android. Ces outils améliorent la vérification et le diagnostic ; ils ne remplacent ni les permissions Android ni le provisioning Device Owner.

## Critères de validation avant activation

- Toute commande distante exige une session administrateur authentifiée et un appareil associé.
- Une commande expirée, répétée ou envoyée à un appareil révoqué est rejetée.
- Le bureau indique clairement « envoyée », « reçue », « exécutée » ou « échec » ; il ne simule pas de résultat.
- La dernière position indique toujours son horodatage et, si disponible, sa précision.
- Les secrets ne sont pas écrits dans les journaux et les données sensibles sont chiffrées en transit.
- Les fonctions d'administration sont testées sur un appareil de test réinitialisable avant un appareil utilisé au quotidien.


## Préparation Android Enterprise — déploiement interne

L'écran **Appareil** propose désormais des actions explicites pour :
- demander l'autorisation de localisation en arrière-plan après l'autorisation au premier plan ;
- demander l'autorisation caméra via Android (aucune capture distante n'est déclenchée par cette autorisation) ;
- activer l'administrateur Android classique depuis l'écran système de confirmation.

### Limites du scénario sans réinitialisation

- Sur un appareil déjà configuré, sans réinitialisation, l'application ne peut généralement pas devenir **Device Owner**. L'enrôlement complet Android Enterprise doit être préparé selon le mode de gestion pris en charge par l'organisation et exige souvent un appareil neuf ou réinitialisé.
- L'administrateur Android classique n'est pas Device Owner et ne rend pas l'application impossible à désinstaller. L'utilisateur peut le désactiver dans les paramètres.
- La permission caméra ne permet pas une capture secrète ni une utilisation garantie en arrière-plan. La capture distante n'est pas implémentée.
- L'autorisation de localisation en arrière-plan ne garantit ni une position fraîche ni une connexion permanente. Aucun service de premier plan persistant n'est intégré à cette version ; Android et les fabricants peuvent suspendre le processus.
- Avant un déploiement en entreprise, valider l'enrôlement, la révocation, la transparence pour les employés et les règles de conservation des positions sur un appareil de test approuvé.


## Service distant visible

Après l'association, l'agent démarre RemoteAgentService au premier plan et affiche une notification permanente avec l'état de connexion et une action Arrêter. En cas de coupure détectée, il tente une reconnexion après 15 secondes. La révocation d'association arrête aussi ce service.

Le service traite les commandes autorisées suivantes : dernière position connue, démarrage/arrêt de sonnerie et notification du message du propriétaire. Les messages apparaissent comme notifications système ; ils ne sont pas garantis à l'écran verrouillé si les notifications sont désactivées. La localisation est la dernière position connue, pas nécessairement un nouveau relevé GPS.

Limite de plateforme : le service utilise le type dataSync et les restrictions Android modernes sur les services au premier plan s'appliquent. L'économie d'énergie, l'arrêt forcé par l'utilisateur, l'absence de réseau ou la révocation peuvent interrompre le service. Aucun contrôle caméra à distance n'est ajouté.


## Inventaire distant en lecture seule

Les commandes **Infos appareil** et **Applications installées** sont disponibles dans l'écran Protection antivol. Elles renvoient respectivement les caractéristiques de base de l'appareil et jusqu'à 80 applications non système visibles par l'application. Android limite la visibilité des paquets selon la version et les déclarations de visibilité : cet inventaire n'est donc pas garanti exhaustif. Ces commandes ne lancent, n'installent ni ne désinstallent aucune application.

## Validation automatique du relais

Le workflow `.github/workflows/relay-tests.yml` lance des tests d'intégration Node.js couvrant le code d'association à usage unique, le relais d'une commande authentifiée et la révocation qui ferme les connexions. Un passage CI réussi ne remplace pas les tests sur un téléphone réel.

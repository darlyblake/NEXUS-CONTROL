# Protection antivol et administration Android

## État réel de la version

La page **Protection antivol** du bureau est une interface de préparation. Elle n'envoie pas encore de commandes de localisation, de sonnerie ou de message à un agent Android distant. Le relais expérimental actuel ne doit pas être présenté comme un service de gestion antivol opérationnel.

## État de la première intégration (octobre 2026)

Le bureau et l'agent Android disposent maintenant d'un premier protocole de commandes via le relais :
- demande de la dernière position connue (permission de localisation Android requise) ;
- démarrage et arrêt de la sonnerie ;
- affichage d'un message dans l'application Android ouverte ;
- validation côté relais du rôle émetteur, de l'action autorisée, de l'identifiant et de l'horodatage de commande.

Ce n'est pas encore un système antivol complet. L'agent doit rester actif et connecté au WebSocket ; la livraison en arrière-plan n'est pas garantie. La localisation n'obtient pas nécessairement un nouveau relevé GPS. Le message n'est pas garanti sur l'écran verrouillé. Le mode Device Owner, les notifications persistantes, l'historique côté serveur et les tests sur un appareil réel restent à faire. Le workflow CI compile l'APK Android ; cela ne remplace pas un test pratique sur téléphone.

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

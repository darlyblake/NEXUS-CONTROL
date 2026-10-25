# NEXUS CONTROL Desktop

Application de bureau Tauri 2 + React + TypeScript.

## Développement local

Depuis ce dossier :

```bash
npm install
npm run tauri dev
```

Pour construire le frontend :

```bash
npm run build
```

## Commandes natives actuellement disponibles

- `get_local_tools` : vérifie la présence de commandes locales (`adb`, `scrcpy`, `node`, `meshcentral`, `wg`).
- `scan_android_devices` : lit la liste retournée par `adb devices -l`.

La version initiale n'exécute pas de commandes arbitraires et ne lance pas encore de sessions distantes. L'intégration MeshCentral est à configurer séparément.

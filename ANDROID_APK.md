# APK Android do Luduo Arcade

O Luduo Arcade agora tem uma versao Android dentro de `android/`. Ela gera um APK instalavel que abre como app normal no celular.

Importante: para os jogos funcionarem fora da mesma Wi-Fi, o servidor Node precisa estar publicado na internet, por exemplo no Render. O APK carrega esse servidor por dentro do app e usa WebSocket para as partidas online.

## Passo 1: publicar o servidor no Render

1. Envie esta pasta `mini` para um repositorio no GitHub.
2. No Render, crie um Web Service usando esse repositorio.
3. Use:
   - Build Command: `npm install`
   - Start Command: `npm start`
   - Health Check Path: `/health`
4. Guarde a URL do Render, por exemplo:

```text
https://luduo-arcade.onrender.com
```

## Passo 2: gerar o APK pelo GitHub

1. No GitHub, abra o repositorio.
2. Entre em `Actions`.
3. Escolha `Gerar APK Android`.
4. Clique em `Run workflow`.
5. No campo `server_url`, coloque a URL do Render.
6. Depois que terminar, baixe o artifact chamado `Luduo-Arcade-APK`.
7. Dentro dele vai estar o arquivo:

```text
app-debug.apk
```

Esse APK pode ser enviado pelo WhatsApp. No celular, toque no arquivo e permita instalar apps de fonte desconhecida se o Android pedir.

## Se for compilar no PC

Este computador precisa ter Android SDK e Gradle. Com eles instalados, rode:

```bash
cd android
gradle assembleDebug -PserverUrl=https://SUA-URL-DO-RENDER.onrender.com
```

O APK sai em:

```text
android/app/build/outputs/apk/debug/app-debug.apk
```

## Como trocar o servidor do app

Na hora de gerar o APK, passe a URL do Render assim:

```bash
gradle assembleDebug -PserverUrl=https://SUA-URL-DO-RENDER.onrender.com
```

Sem isso, o app usa o padrao:

```text
https://luduo-arcade.onrender.com
```

# Luduo Arcade

Luduo Arcade e um app para Android feito para juntar varios minijogos online. O primeiro jogo incluido e o DuoPong: cada jogador entra pelo celular, escolhe um nome unico, desafia outro jogador pelo nome e joga em tempo real.

## O que ja vem pronto

- App com tema escuro.
- Tela inicial para escolher nome.
- Servidor online com nomes unicos enquanto o jogador esta conectado.
- Lobby com lista de jogadores online e busca por nome.
- Convite para jogar em dupla.
- Primeiro minijogo: DuoPong.
- Controle por toque na parte de baixo da tela.
- Bola com velocidade subindo a cada 5 segundos: 1, 2, 3, 4...
- Estrutura preparada para adicionar novos minijogos.
- PWA instalavel no Android.
- Projeto Android para gerar APK instalavel.
- Workflow do GitHub Actions para gerar APK na nuvem.
- Configuracao para publicar no Render.

## Como rodar no computador

Entre na pasta `mini` e rode:

```bash
cmd /c npm start
```

Depois abra:

```text
http://localhost:3000
```

Para testar em dois celulares na mesma rede Wi-Fi, descubra o IP do computador e abra no celular:

```text
http://IP-DO-COMPUTADOR:3000
```

Exemplo:

```text
http://192.168.0.10:3000
```

## Como mandar pelo WhatsApp como APK

Para mandar como aplicativo de verdade, gere o APK Android. As instrucoes estao em:

```text
ANDROID_APK.md
```

Este computador nao tem Android SDK/Gradle instalado, entao nao foi possivel compilar o APK localmente agora. Por isso deixei um workflow do GitHub Actions que gera o APK na nuvem.

## Como publicar no Render

1. Crie um repositorio no GitHub.
2. Envie todos os arquivos desta pasta `mini` para o repositorio.
3. No Render, crie um `Web Service` ligado ao repositorio.
4. Use:
   - Build Command: `npm install`
   - Start Command: `npm start`
5. Depois de publicado, envie o link do Render pelo WhatsApp.

O arquivo `render.yaml` tambem permite criar o servico usando Blueprint no Render.

## Como o online funciona fora da mesma Wi-Fi

Os celulares nao conectam direto um no outro. Todos entram no mesmo servidor publicado no Render. O servidor guarda os nomes online, envia convites e sincroniza o DuoPong em tempo real.

O APK precisa ser gerado apontando para a URL publica do Render. Assim ele funciona em qualquer internet: Wi-Fi, 4G ou 5G.

## Como adicionar novos minijogos

No app, o registro dos jogos fica em:

```text
public/app.js
```

Procure por `MINIGAMES`. Para adicionar um novo jogo, crie uma nova entrada ali e implemente a tela/logica seguindo o padrao do DuoPong.

No servidor, cada tipo de jogo pode ter sua propria sala. A implementacao atual fica em:

```text
server/index.js
```

Procure por `createDuoPongRoom` e use a mesma ideia para novos jogos.

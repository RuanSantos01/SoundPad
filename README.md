# SoundPad

Pads de som que tocam no instante do toque, direto no navegador — incluindo o Safari do iPhone.

**No ar em https://ruansantos01.github.io/SoundPad/**

No iPhone: abra esse endereço no Safari e faça **Compartilhar → Adicionar à Tela de Início**.
Vira um app em tela cheia que funciona offline.

## Rodar localmente

```bash
node serve.mjs
```

O terminal mostra dois endereços: um para este Mac e um para o iPhone (precisa estar no
mesmo Wi-Fi). Não há dependências nem build — é HTML, CSS e JS puros, então o que roda
local é exatamente o que está publicado.

Publicar uma mudança é só `git push`: o GitHub Pages serve a branch `main`.

## Primeiro toque

O iOS abre toda página com o áudio suspenso. O primeiro toque em qualquer lugar destrava —
o pad que você tocar já sai com som, não é um toque desperdiçado.

## Pastas

Cada pasta é uma situação — uma live, um podcast, um set — com **16 pads próprios**.
A barra logo abaixo do título lista as pastas; o `+` cria mais.

- Ao criar, escolha começar com **pads vazios** ou com uma cópia do **kit de bateria**.
- **Editar** → toque no nome da pasta para renomear, apagar ou **carregar vários sons de
  uma vez**. Apagar pede confirmação e leva junto os sons daquela pasta.
- **Editar** → **arraste** os nomes para trocar a ordem das pastas. Arrastando até a borda,
  a barra rola sozinha. Fora do modo editar a barra só rola, sem reordenar nada.
- Trocar de pasta **não interrompe** o que está tocando. Dá para deixar um loop rodando em
  "Ambiente" e ir disparar efeitos em outra pasta — o botão **Parar (n)** mostra quantos
  sons estão no ar, inclusive os de pastas fechadas.
- No computador, `←` e `→` trocam de pasta.

## Pads

- **Toque** dispara o som. Vários dedos ao mesmo tempo disparam vários pads.
- **Pad vazio** (tracejado) abre direto a escolha do arquivo.
- Ao escolher arquivos, **dá para marcar vários**: eles caem nos pads a partir daquele,
  um por um.
- **Editar** → toque num pad para trocar o som, o nome, a cor, o volume e o modo:
  - `disparo` — toca até o fim
  - `segurar` — toca enquanto o dedo estiver no pad
  - `loop` — toca em ciclo; o segundo toque desliga
- **Parar** silencia tudo, de todas as pastas.
- No computador, as teclas `1234 QWER ASDF ZXCV` tocam os 16 pads.

### Encher uma pasta de uma vez

Para montar uma pasta de 16 sons sem repetir o mesmo caminho 16 vezes:
**Editar** → toque no nome da pasta → **Carregar vários sons…** → selecione tudo de uma vez.
Os arquivos entram nos pads vazios, na ordem, e o nome de cada pad vira o nome do arquivo.
Pads que já têm som são preservados. Se sobrarem arquivos além dos 16 pads, o app diz
quantos ficaram de fora; se algum arquivo não puder ser lido, ele diz qual.

A pasta "Bateria" vem com 16 sons sintetizados pelo próprio navegador — nenhum arquivo
para baixar. Seus arquivos (MP3, M4A, WAV, AAC) ficam salvos no aparelho, no IndexedDB, e
voltam sempre que você reabrir.

## Por que o som sai junto com o toque

- **Web Audio API com o áudio já decodificado na memória.** Um `<audio>.play()` no iOS
  custa de dezenas a centenas de milissegundos; `AudioBufferSourceNode.start()` dispara no
  próximo bloco de áudio.
- **Evento `touchstart`, não `click`.** O iOS só emite `click` no fim do toque, e com
  atraso. Medido aqui: **0,2 ms** entre o toque e o disparo.
- **`latencyHint: 'interactive'`** pede ao sistema o menor buffer de saída possível.
- **`navigator.audioSession = 'playback'`** (iOS 16.4+) faz o som tocar mesmo com a
  chavinha de silencioso ligada. Em iOS mais antigo, desligue o silencioso.

O que sobra é a latência do próprio hardware de saída (~20–40 ms no iPhone, e mais se for
por Bluetooth). Fone com fio ou o alto-falante do aparelho respondem bem mais rápido que
AirPods.

## Arquivos

| | |
|---|---|
| `index.html` | estrutura da tela |
| `app.js` | motor de áudio, pastas, pads, toque, persistência |
| `styles.css` | visual |
| `sw.js` + `manifest.webmanifest` | instalação na tela de início e uso offline |
| `serve.mjs` | servidor local para testar no iPhone |

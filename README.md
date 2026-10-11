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

## Os sons somem com o tempo?

Eles ficam no IndexedDB, no navegador daquele aparelho. Três riscos, em ordem de
probabilidade:

1. **Inatividade.** O Safari apaga o armazenamento de sites não visitados por 7 dias.
2. **Falta de espaço.** O sistema pode despejar dados de sites para liberar disco.
3. **Limpeza manual.** "Limpar Histórico e Dados dos Sites" leva tudo junto.

Contra os dois primeiros o app pede `navigator.storage.persist()` ao abrir. Medido no
Safari do iOS (simulador, iPhone 16 Pro):

| Como o app foi aberto | `persist()` |
|---|---|
| Aba normal do Safari | **negado** |
| Ícone na Tela de Início (standalone) | **concedido** |

Ou seja: **adicionar à Tela de Início é o que protege os sons**, não só conforto de tela
cheia. Quando o pedido é negado e existem sons próprios carregados, o app mostra um aviso.

Contra o terceiro risco (limpeza manual, ou apagar o ícone) não há API que ajude — só uma
cópia dos arquivos originais resolve.

## Primeiro toque, e volta do segundo plano

O iOS abre toda página com o áudio suspenso, e **suspende de novo toda vez que o app vai
para segundo plano** (trocar de app, ligação, bloquear a tela). O indicador ao lado do
título fica cinza quando isso acontece.

O toque seguinte resolve, e o som desse toque sai — não é um toque desperdiçado. Isso
exigiu cuidado: medido no Safari do iOS, com o contexto suspenso o `start()` não toca nada
e o `onended` nunca dispara, ou seja, **a voz é descartada em silêncio**. Como `resume()`
é assíncrono, "retomar e tocar na linha seguinte" era uma corrida que às vezes perdia — era
essa a causa do som falhar de forma intermitente.

Hoje o `trigger()` dispara na hora quando o contexto está de pé, e quando não está,
destrava dentro do gesto e só solta a voz depois que o contexto volta.

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
- **Não forçamos `navigator.audioSession.type`.** A tentação é usar `'playback'` para
  tocar com a chavinha de silencioso ligada. Medido no Safari do iOS, com dois contextos
  novos e idênticos:

  | `audioSession` | estado | tocou |
  |---|---|---|
  | `auto` (padrão) | `running` | sim, imediato |
  | `playback` | `interrupted` | **não** |

  O buffer de saída é o mesmo nos dois (2,7 ms): `'playback'` simplesmente derruba a
  sessão. Preço de ficar no padrão: **com o silencioso ligado o iOS pode calar o som** —
  se um pad não sair, confira a chavinha lateral.

- **O limitador é um WaveShaper, não um DynamicsCompressor.** Medido nos dois motores, o
  compressor custa 6 ms de atraso na entrada e 6 ms de cauda depois que a fonte para —
  ele atrasa tudo para antecipar picos. O WaveShaper satura amostra a amostra: zero
  atraso, zero cauda, e ainda segura pico de 2,5 em 0,93.

O que sobra é a latência do próprio hardware de saída. **Entre em Editar para ver o número
do seu aparelho** — o app mostra `saída ~N ms`. Alto-falante ou fone com fio ficam na casa
de 10–40 ms; fone Bluetooth costuma somar 150–300 ms, e nenhuma linha de código muda isso.

## Arquivos

| | |
|---|---|
| `index.html` | estrutura da tela |
| `app.js` | motor de áudio, pastas, pads, toque, persistência |
| `styles.css` | visual |
| `sw.js` + `manifest.webmanifest` | instalação na tela de início e uso offline |
| `serve.mjs` | servidor local para testar no iPhone |
| `vercel.json` | cabeçalhos do deploy na Vercel (ver abaixo) |

## Hospedagem

O app é estático: qualquer host serve. Hoje está no GitHub Pages, publicado a cada
`git push` na `main`.

O `vercel.json` existe para três coisas que quebram um PWA se ficarem no padrão:

- **`sw.js` sem cache.** Se o service worker vier de cache, uma versão antiga do app fica
  presa no aparelho e nenhum deploy novo chega.
- **`manifest.webmanifest` com `application/manifest+json`.** Sem o tipo certo o iOS
  ignora o manifest e o "Adicionar à Tela de Início" perde nome e ícone.
- **`app.js` / `styles.css` revalidando sempre.** Os nomes não têm hash, então sem isso o
  navegador segura a versão velha.

Atenção ao trocar de endereço: **cada domínio tem seu próprio armazenamento.** Os sons
ficam no IndexedDB, que é por origem — o que você carregou em `github.io` não aparece em
`vercel.app`. Escolha um endereço e fique nele.

# 🇪🇸 Españolia — App de leitura em espanhol

App PWA (funciona no navegador e pode ser "instalado" no celular) para ler textos em
espanhol, marcar/salvar palavras, montar seu vocabulário e revisar com flashcards
(repetição espaçada). Tudo salvo numa planilha do Google Sheets — sem custo de servidor.

---

## Como está organizado

```
lingua-app/
├── index.html          → estrutura do app
├── style.css            → tema visual (cores da Espanha: vermelho e dourado)
├── app.js                → toda a lógica (leitor, popup, vocabulário, flashcards)
├── manifest.json         → configuração do PWA
├── service-worker.js     → cache offline básico
├── icons/                → ícones do app
└── apps-script/Code.gs   → BACKEND — cole isso no Google Apps Script
```

---

## PASSO 1 — Criar a planilha (o banco de dados)

1. Acesse [sheets.google.com](https://sheets.google.com) e crie uma planilha nova.
   Dê o nome que quiser, ex: **"Españolia DB"**.
2. No menu, vá em **Extensões → Apps Script**.
3. Apague todo o código que aparece por padrão e cole o conteúdo do arquivo
   `apps-script/Code.gs` (está neste projeto).
4. No topo, clique em **Salvar** (ícone de disquete).
5. No seletor de funções (ao lado do botão "Depurar"), escolha a função **`setup`**
   e clique em **Executar**. Na primeira vez o Google vai pedir permissão — autorize
   com sua conta. Isso cria automaticamente as abas `Vocabulario`, `Lecciones` e
   `Historial` na sua planilha, já com os cabeçalhos certos.

## PASSO 2 — Publicar como API (Web App)

1. Ainda no Apps Script, clique em **Implantar → Nova implantação**.
2. Clique no ícone de engrenagem ao lado de "Selecionar tipo" e escolha **App da Web**.
3. Configure:
   - **Executar como:** Eu (seu e-mail)
   - **Quem pode acessar:** Qualquer pessoa
4. Clique em **Implantar** e autorize novamente se for pedido.
5. Copie a **URL do app da Web** gerada (termina em `/exec`). Você vai usar essa
   URL dentro do app.

> Sempre que você editar o `Code.gs`, precisa criar **uma nova implantação** (ou usar
> "Gerenciar implantações → editar → nova versão") para as mudanças valerem.

## PASSO 3 — Subir o app no GitHub Pages

1. Crie um repositório novo no GitHub (ex: `espanolia-app`).
2. Suba todos os arquivos desta pasta (`index.html`, `style.css`, `app.js`,
   `manifest.json`, `service-worker.js`, `icons/`) para a raiz do repositório.
3. Vá em **Settings → Pages**, em "Source" escolha a branch `main` e pasta `/root`.
4. Salve. Em alguns minutos seu app estará disponível em algo como:
   `https://seu-usuario.github.io/espanolia-app/`

## PASSO 4 — Conectar o app à sua planilha

1. Abra o link do seu app no navegador (ou no celular).
2. Na primeira tela, cole a URL que você copiou no Passo 2 (a que termina em `/exec`).
3. Clique em **Conectar**. Pronto — o app já está funcionando com sua planilha.

No celular, use "Adicionar à tela inicial" (Chrome/Safari) para instalar como app (PWA).

---

## Como usar

- **Importar**: cole uma URL (o app extrai o texto legível automaticamente) ou cole
  um texto direto. Vira uma "lição" salva na aba `Lecciones`.
- **Leitor**: toque em qualquer palavra do texto para abrir o painel de baixo.
  Você pode traduzir automaticamente (botão "Traduzir (Google)", usa tradução
  nativa e gratuita do Google), editar a tradução, adicionar categoria e salvar.
  Palavras salvas ficam destacadas com uma cor que indica o nível de domínio
  (vermelho = nova, dourado = intermediária, verde = dominada).
- **Vocabulario**: lista de tudo que você salvou, com busca e filtro por nível.
- **Flashcards**: revisão espaçada estilo Leitner (5 caixas). Você escolhe o sentido
  (Espanhol → Português ou Português → Espanhol). Quando acerta, a palavra "sobe de
  caixa" e demora mais pra aparecer de novo; quando erra, volta pra caixa 1.

---

## Lembrete diário (notificação push gratuita, mesmo com o app fechado)

Isso usa dois recursos gratuitos combinados: os **gatilhos automáticos do
Apps Script** (roda no servidor do Google todo dia, sem precisar do seu
celular ligado) e o **[ntfy.sh](https://ntfy.sh)** (serviço de notificação
push, gratuito, sem necessidade de conta).

**1. Escolha um "canal" secreto**
No `Code.gs`, encontre a linha `const NTFY_TOPIC = '';` e preencha com um
nome único e difícil de adivinhar, tipo `espanolia-joao8823` (evite algo
genérico — quem souber o nome recebe suas notificações também). Salve e
gere uma nova versão da implantação.

**2. Instale o app ntfy no celular**
- Android: [Google Play](https://play.google.com/store/apps/details?id=io.heckel.ntfy)
- iPhone: [App Store](https://apps.apple.com/app/ntfy/id1625396347)
- Abra o app, toque em "+", cole exatamente o mesmo nome de canal que você
  colocou em `NTFY_TOPIC`, e pronto — está inscrito.

**3. Configure o gatilho automático no Apps Script**
1. No editor do Apps Script, clique no ícone de **relógio ⏰ (Gatilhos)** na barra lateral esquerda
2. **+ Adicionar gatilho**
3. Função a executar: `sendDailyReminder`
4. Fonte do evento: **Baseado em tempo**
5. Tipo de gatilho: **Cronômetro diário**
6. Escolha o horário (ex: entre 9h e 10h)
7. Salvar (autorize se pedir)

Pronto — todo dia nesse horário, se você tiver palavras pendentes de
revisão, vai chegar uma notificação no seu celular. Se não tiver nada
pendente, ele não manda nada (não enche seu celular à toa).

## Conjugador de verbos

Ao marcar uma categoria como verbo no popup da palavra (botão "🔤 Es un
verbo — conjugar"), o app tenta adivinhar o infinitivo automaticamente e
gera uma tabela com Presente, Pretérito indefinido, Imperfecto, Futuro,
Condicional e Subjuntivo presente — tudo calculado no próprio app (offline,
sem depender de nenhuma API paga). Como adivinhar o infinitivo a partir de
uma palavra conjugada é difícil de acertar sempre, o campo é editável:
confira o palpite antes de gerar a tabela, e corrija se precisar.

## Expressões (frases)

No leitor, toque no ícone 🔗 no topo para ativar o "modo expressão". Toque
em várias palavras seguidas (elas ficam destacadas em dourado) e depois em
"Guardar expresión" — a frase inteira é salva no seu vocabulário como uma
única entrada, com a categoria "expresión" já preenchida.

## Notas técnicas



- A tradução usa `LanguageApp.translate()`, nativo do Google Apps Script —
  **gratuito e sem necessidade de chave de API**.
- A importação por URL usa o serviço público `r.jina.ai` para extrair o texto
  legível de qualquer página, evitando problemas de CORS.
- Todos os dados (vocabulário, lições, histórico de revisões) ficam só na SUA
  planilha do Google — você é dono dos dados e pode editar/exportar quando quiser.

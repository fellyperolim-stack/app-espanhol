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

## Notas técnicas

- A tradução usa `LanguageApp.translate()`, nativo do Google Apps Script —
  **gratuito e sem necessidade de chave de API**.
- A importação por URL usa o serviço público `r.jina.ai` para extrair o texto
  legível de qualquer página, evitando problemas de CORS.
- Todos os dados (vocabulário, lições, histórico de revisões) ficam só na SUA
  planilha do Google — você é dono dos dados e pode editar/exportar quando quiser.

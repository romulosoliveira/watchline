</Agent System Instructions>
<Watchline 📺>
![Version](https://img.shields.io/badge/version-v1.1.0-blue.svg)
![Stack Principal](https://img.shields.io/badge/stack-Vanilla_JS-yellow.svg)
![Platform](https://img.shields.io/badge/platform-Web_PWA-lightgrey.svg)
![License](https://img.shields.io/badge/license-Proprietary-red.svg)

**Watchline** é uma aplicação web PWA offline-first desenvolvida em Vanilla JavaScript para o gerenciamento de bibliotecas pessoais de entretenimento (séries e filmes). A arquitetura central é baseada em um motor de reatividade customizado guiado por estado local, sem dependência de frameworks pesados, garantindo alta performance e execução nativa no browser, com sincronização em nuvem via Google Drive API.

---

## 🎯 O que o sistema faz?
O sistema soluciona o problema de rastreamento distribuído e perda de histórico de entretenimento ao centralizar as informações de séries e filmes consumidos pelo usuário. Ele automatiza a coleta de metadados (episódios, temporadas, pôsteres e sinopses) diretamente das APIs do TVMaze e TMDB, armazenando os dados primariamente offline e persistindo um backup automático no Google Drive.

## 🚀 Arquitetura e Principais Funcionalidades
- **Core State Engine**: Motor de renderização reativo baseado em template literals e injeção direta no DOM (`app.innerHTML`). O loop de atualização reconstrói os nós visuais (`render()`) imediatamente após as mutações do objeto de estado central global.
- **Offline-First / PWA**: Utiliza Service Workers (`sw.js`) com estratégia Cache First/Network Fallback para os assets (App Shell) e interceptação de rotas, permitindo uso 100% offline.
- **Integração de APIs de Mídia**: Pipeline de dados assíncrono que ingere e normaliza payloads JSON estruturados do TVMaze e The Movie Database (TMDB) para povoar os cards locais com dados exatos de episódios faltantes ou datas de estreia.
- **Controle/Processamento**: Processamento em segundo plano via `window.setInterval` e callbacks lógicos para atualização em lote (batch processing) das sinopses e catálogos (`startAutoCatalogSync`, `startMoviePosterSync`), garantindo que a main thread (Event Loop da GUI) não seja excessivamente bloqueada.

## 🧠 Under the Hood (Detalhes Técnicos)
- **Data Flow / Estrutura**: Os dados trafegam primariamente em memória no objeto global JS, e são serializados em JSON persistindo em baixo nível no banco do browser via **IndexedDB** (`idbGet`, `idbSet`). Há um pipeline bidirecional atrelado à visibilidade da página para enviar o delta das mutações locais num blob `tvtracker-data.json` rumo ao Google Drive via REST API.
- **Integrações / APIs**: Comunicação remota com `api.tvmaze.com`, `api.themoviedb.org`, e `googleapis.com/auth/drive.file`. Uso intenso de Promises e `fetch` nativo para resolver fluxos de I/O de rede. O design inclui atalhos globais interceptados na janela global (`Ctrl+K` para Command Palette).

## ⚙️ Instalação e Execução

### Pré-requisitos
- **Navegador Web Moderno** (Chrome, Firefox, Safari ou Edge).
- Servidor HTTP estático básico (ex: `python -m http.server`, `Live Server` do VSCode, `http-server` do Node).

### Setup (Ambiente de Desenvolvimento)
1. Clone este repositório.
2. Inicie um servidor web na raiz do projeto (como não há build ou bundler, a execução é direta):
   ```cmd
   npx http-server -p 8080
   # ou via python:
   python -m http.server 8080
   ```
3. Acesse a aplicação:
   ```cmd
   Abra http://localhost:8080 no navegador.
   ```

## 📦 Build para Produção
O projeto foi estruturado sem steps de compilação ou transpilação (Vanilla ES6 modules). O "build" consiste em implantar os arquivos estáticos (HTML, CSS, JS e pasta `assets/`) diretamente em uma CDN, Edge Network ou serviço de hospedagem estática (como Vercel, Netlify ou GitHub Pages). O cache-busting é gerenciado via query parameters explícitos (`?v=13`) atrelados na montagem do service worker.
</Watchline 📺>

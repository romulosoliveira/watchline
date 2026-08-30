# Watchline 📺
![Version](https://img.shields.io/badge/version-v1.1.0-blue.svg)
![JavaScript](https://img.shields.io/badge/javascript-ES6%2B-yellow.svg)
![Platform](https://img.shields.io/badge/platform-Web-lightgrey.svg)
![License](https://img.shields.io/badge/license-MIT-green.svg)

**Watchline** é uma aplicação web progressiva (PWA) de rastreamento pessoal de séries e filmes, projetada para usuários que desejam organizar e acompanhar seu consumo de mídia de forma centralizada e sincronizada na nuvem.

---

## 🎯 O que o sistema faz?

O sistema permite que os usuários pesquisem, adicionem e acompanhem o progresso de séries de TV e filmes através de uma interface moderna e rápida. Ele utiliza as APIs do TVMaze e TMDB para buscar metadados atualizados sobre os conteúdos, mantendo um registro detalhado de episódios assistidos e filmes vistos.

Além disso, o Watchline opera totalmente no navegador cliente (client-side) e sincroniza automaticamente os dados do usuário com o Google Drive, garantindo que o histórico e as listas personalizadas estejam sempre seguros, privados e acessíveis de qualquer dispositivo.

## 🚀 Principais Funcionalidades

- **Rastreamento de Mídia**: Acompanhe séries e filmes, marque episódios como assistidos e organize seu catálogo pessoal.
- **Sincronização com Google Drive**: Salve e sincronize seus dados automaticamente e de forma segura utilizando sua própria conta Google.
- **Integração com APIs Externas**: Busca automática de informações, capas e detalhes de episódios através das APIs TVMaze e TMDB.
- **Paleta de Comandos (Command Palette)**: Navegação rápida e pesquisa global utilizando o atalho prático (Ctrl/Cmd + K).
- **Suporte PWA (Progressive Web App)**: Acesso offline e capacidade de ser instalado no computador ou smartphone como um aplicativo nativo.

## ⚙️ Instalação e Execução

### Pré-requisitos
- **Node.js** (opcional, para rodar um servidor local) ou qualquer outro servidor web estático.

### Setup Rápido (Via Código-Fonte)
1. Clone ou baixe este repositório.
2. Abra o Prompt de Comando na pasta raiz do projeto e inicie um servidor estático simples. Exemplo usando `npx`:
   ```cmd
   npx serve .
   ```
3. Abra o navegador e acesse a URL gerada (geralmente `http://localhost:3000`).

## 📦 Gerar Executável (Windows)

Como o projeto é um Progressive Web App (PWA), a instalação no Windows ocorre via navegador sem necessidade de compilação de `.exe`:

1. Acesse o sistema pelo navegador (Google Chrome ou Microsoft Edge).
2. Clique no ícone de "Instalar aplicativo" (localizado na barra de endereços).
3. O Watchline será instalado e ficará acessível a partir do Menu Iniciar, como um aplicativo desktop comum.

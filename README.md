# Ipaporanga Notícias — novo front-end (layout Intercept)

Site estático que lê as matérias do blog **ipaporanganoticias.com.br** (Blogger) e as exibe com o layout do Intercept Brasil.
O blog original continua funcionando normalmente; este site só **lê** os dados dele.

## Colocar no ar (GitHub Pages)

Repositório: `ericksmatias/ipaporanganoticias` → site em **https://ericksmatias.github.io/ipaporanganoticias/**

A pasta `docs/` é o site em si (HTML, CSS, JS e dados). O nome é só convenção do GitHub Pages; não é uma pasta de documentação.

1. Envie **tudo** deste projeto para a branch `main` do repositório (as pastas `docs/`, `tools/` e `.github/` e os arquivos da raiz).
2. No GitHub: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. Vá em **Actions → "Atualizar notícias e publicar no GitHub Pages" → Run workflow**. Em 1–2 minutos o site abre no endereço acima.
4. Depois disso ele se atualiza sozinho a cada 30 minutos e a cada novo push.

Alternativa sem Actions: **Source: Deploy from a branch → `main` / pasta `/docs`**. Funciona, mas só mostra as matérias que já estão no repositório (95 do zip) mais as publicadas depois, via feed ao vivo no navegador.

## Como os dados chegam

| Camada | O que faz |
|---|---|
| `tools/fetch_feed.py` (roda no Action) | Baixa o feed JSON do Blogger (`/feeds/posts/default?alt=json`), guarda até 600 matérias em `docs/data/posts.json` e gera `docs/p/<matéria>.html` (páginas com título e imagem para prévia no WhatsApp/Facebook), `sitemap.xml` e `robots.txt`. Se o Blogger estiver fora do ar, publica com os dados que já estão no repositório. |
| `docs/data/posts.json` | Matérias já salvas. Começa com as 95 do zip que você enviou. |
| Feed ao vivo (no navegador) | Ao abrir a home, o site pede ao Blogger as 30 matérias mais novas (JSONP) e acrescenta o que ainda não estiver no JSON. Aparece o aviso "N matérias novas do site original". |

`tools/build_from_zip.py <pasta do wget>` regenera o JSON a partir de uma cópia local do blog.

## Páginas

- `index.html` — home (destaque, últimas, seções por categoria)
- `post.html?p=2026/11/slug` e `p/2026-11-slug.html` — matéria (a segunda é a versão para compartilhar)
- `categoria.html?c=policia` · `?l=Rótulo` · `?q=busca` — listagens e busca
- `pagina.html?p=sobre-o-autor` — páginas estáticas do Blogger
- `404.html`

## Ajustes rápidos (`docs/config.json`)

- `categories`: os rótulos do Blogger são bagunçados (`Policia`, `Policia.`, `POLÍCIA.`, `Policial`…). Cada categoria agrupa as variações em `match` (minúsculas, sem acento e sem ponto).
- `whatsapp`, `social`: links do cabeçalho/rodapé.
- `maxPostsInJson`: quantas matérias ficam salvas.
- `liveFeed: false` desliga a consulta ao vivo.

## Cor e fontes

O CSS (`docs/assets/css/intercept.css`) e as fontes (`docs/assets/fonts`) foram extraídos das páginas salvas do Intercept. Para trocar o roxo por outra cor, mude `--bs-primary`, `--bs-primary-rgb`, `--feeds-hat-color` e `--inputs-accent-color` em `:root`, e `#6653ff` nas regras do CSS (busca e substitua).
As fontes **TIActuBeta**, **TIActuBetaMono** e **Newsreader** (esta é livre) fazem parte da identidade do Intercept. Para um site público, troque as duas primeiras por fontes livres (por exemplo Inter e JetBrains Mono) e substitua o roxo, para não parecer o site deles.

## Limites conhecidos

- **Matérias antigas:** só estão disponíveis as que estão em `posts.json` (últimas 600) e o feed ao vivo. Categorias e busca olham só essas; há um link "ver no site original" para o resto. Abrir uma matéria antiga por link direto tenta o feed do Blogger e, se não achar, mostra o link do original.
- **Feed ao vivo:** usa JSONP, que não depende de CORS. Não foi possível testar contra o blog real no ambiente em que isto foi montado (sem acesso à internet); o teste foi com um Blogger simulado.
- **Anúncios (AdSense) e comentários** do site original não existem aqui.
- **Prévia de links:** só as páginas `p/*.html` têm título/imagem para WhatsApp e Facebook. Compartilhe sempre esse endereço.
- Imagens vêm direto do `blogger.googleusercontent.com`; se o autor apagar uma foto no Blogger, ela some aqui também.

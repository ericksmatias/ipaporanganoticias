# Ipaporanga Notícias — novo front-end

Site estático que lê as matérias do blog **ipaporanganoticias.com.br** (Blogger) e as exibe com um visual próprio (vidro, hero de noticiário, tipografia condensada).
O blog original continua funcionando normalmente; este site só **lê** os dados dele.

## Colocar no ar (GitHub Pages, deploy pela branch)

Repositório: `ericksmatias/ipaporanganoticias` → site em **https://ericksmatias.github.io/ipaporanganoticias/**

A pasta `docs/` é o site em si. Em **Settings → Pages**: *Source = Deploy from a branch*, branch `main`, pasta `/docs`.

Para substituir o repositório inteiro por esta versão (apaga o histórico anterior), dentro da pasta descompactada:

```bash
git init -b main
git add -A
git commit -m "Novo front-end Ipaporanga"
git remote add origin https://github.com/ericksmatias/ipaporanganoticias.git
git push --force -u origin main
```

Depois, em **Actions → "Atualizar notícias do Blogger" → Run workflow** para testar a atualização automática.
Como o workflow grava commits no repositório, rode `git pull --rebase` antes de qualquer push seu.

## De onde vêm as notícias

Direto do **Blogger** (não do site ipaporanganoticias.com.br), pelo feed do blog `2142557176456918842`:
`https://www.blogger.com/feeds/2142557176456918842/posts/default` (configurado em `docs/config.json` → `feedBase`).

| Camada | O que faz |
|---|---|
| `.github/workflows/update.yml` (a cada 10 min) | Roda `tools/fetch_feed.py`: baixa o feed do Blogger, atualiza `docs/data/posts.json` (até 600 matérias), gera `docs/p/*.html` (páginas com título e imagem para prévia no WhatsApp/Facebook), `sitemap.xml` e `robots.txt`, e faz commit só se houver novidade. O Pages republica sozinho a cada commit. |
| `docs/data/posts.json` | Matérias salvas. Começa com as 95 do zip original. |
| Feed ao vivo (no navegador) | Ao abrir o site, pede ao Blogger as 30 matérias mais novas (JSONP) e acrescenta o que ainda não estiver no JSON ("N matérias novas do Blogger"). Se o feed falhar, avisa na tela e mostra as matérias salvas. |

Os links "Site original" e "ver no site original" só levam o leitor ao endereço público do blog; nenhum dado é lido dali.

`tools/build_from_zip.py <pasta do wget>` regenera o JSON a partir de uma cópia local do blog.

## Páginas

- `index.html` — home (destaque, últimas, seções por categoria)
- `post.html?p=2026/11/slug` e `p/2026-11-slug.html` — matéria (a segunda é a versão para compartilhar)
- `categoria.html?c=policia` · `?l=Rótulo` · `?q=busca` — listagens e busca
- `pagina.html?p=sobre-o-autor` — página "Sobre" desenhada à mão (Gonçalinho Rodrigues); as demais páginas vêm do Blogger
- `404.html`

## Ajustes rápidos (`docs/config.json`)

- `categories`: os rótulos do Blogger são bagunçados (`Policia`, `Policia.`, `POLÍCIA.`, `Policial`…). Cada categoria agrupa as variações em `match` (minúsculas, sem acento e sem ponto).
- `whatsapp`, `social`: links do cabeçalho/rodapé.
- `maxPostsInJson`: quantas matérias ficam salvas.
- `liveFeed: false` desliga a consulta ao vivo.

## Visual, cor e fontes

Todo o CSS é próprio (`docs/assets/css/ipa.css`) e não usa código de terceiros. Cores principais em `:root` (`--red`, `--crimson`, `--ink`).
Fontes livres (licença OFL), hospedadas em `docs/assets/fonts`: **Inter**, **Barlow Condensed** e **Newsreader**.
Logo em `docs/assets/img` (`logo.png` para fundo claro, `logo-light.png` para fundo escuro). O fundo animado do hero está em `assets/js/fx.js` (canvas leve, pausa fora da tela e respeita "reduzir movimento").
O crédito "Desenvolvido por Erick Matias" fica no rodapé (`renderChrome` em `assets/js/app.js`).

## Limites conhecidos

- **Matérias antigas:** só estão disponíveis as que estão em `posts.json` (últimas 600) e o feed ao vivo. Categorias e busca olham só essas; há um link "ver no site original" para o resto. Abrir uma matéria antiga por link direto tenta o feed do Blogger e, se não achar, mostra o link do original.
- **Feed do Blogger:** usa JSONP, que não depende de CORS. Foi testado com um Blogger simulado; confirme no site real (F12 → Network → chamada para `blogger.com/feeds/...`).
- **Anúncios (AdSense) e comentários** do site original não existem aqui.
- **Prévia de links:** só as páginas `p/*.html` têm título/imagem para WhatsApp e Facebook. Compartilhe sempre esse endereço.
- Imagens vêm direto do `blogger.googleusercontent.com`; se o autor apagar uma foto no Blogger, ela some aqui também.

## Páginas institucionais

Política de Privacidade e Termos de Uso ficam formatados em `docs/assets/js/legal.js` (o robô não mexe nesse arquivo). Para mudar o texto, edite esse arquivo.

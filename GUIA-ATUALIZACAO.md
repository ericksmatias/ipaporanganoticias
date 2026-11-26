# Guia: como o site se atualiza sozinho (passo a passo para leigos)

## Como funciona (a ideia em 4 linhas)
1. O **Gonçalinho continua publicando no Blogger**, como sempre. O Blogger é a "redação".
2. O **GitHub** guarda o site novo. Um "robô" (a Action) vai ao Blogger **a cada 10 minutos**, copia as matérias novas e salva no site.
3. O **GitHub Pages** coloca no ar tudo o que o robô salvou. Você não faz nada.
4. Além do robô, quando alguém abre o site, o próprio navegador também pergunta ao Blogger se há algo novo. Se o robô atrasar, o leitor ainda vê a matéria nova.

> Regra de ouro: **não apague nem desative o blog no Blogger.** O site novo só lê dele.

---

## Parte A — Ligar o robô (faça uma vez)

**Passo 1. Liberar o robô para salvar no repositório**
1. Abra o repositório no GitHub (github.com/ericksmatias/ipaporanganoticias).
2. Clique em **Settings** (engrenagem, no topo).
3. Menu da esquerda: **Actions** → **General**.
4. Role até **Workflow permissions** e marque **Read and write permissions**. Clique em **Save**.
   (Sem isso o robô baixa as matérias mas não consegue salvar.)

**Passo 2. Conferir se as Actions estão ligadas**
1. Clique na aba **Actions** (no topo, ao lado de Pull requests).
2. Se aparecer um botão verde "I understand my workflows, go ahead and enable them", clique nele.

**Passo 3. Rodar o robô na mão, para testar**
1. Na aba **Actions**, clique em **Atualizar notícias do Blogger** (lista da esquerda).
2. Clique em **Run workflow** (botão à direita) → **Run workflow** de novo.
3. Espere 1 a 2 minutos e atualize a página. Deve aparecer uma linha com **bolinha verde ✔**.
   - **Verde:** funcionou.
   - **Vermelha ✖:** clique nela, depois em "update" e copie o erro que aparece. Me mande que eu resolvo.
4. Volte para a aba **Code**. Se houve matéria nova, aparece um commit "Atualiza matérias do Blogger" feito por github-actions[bot]. Se não houve, tudo bem: o robô só salva quando há novidade.

**Passo 4. Conferir o Pages**
1. **Settings → Pages**.
2. Em **Build and deployment**: Source = **Deploy from a branch**, Branch = **main**, pasta = **/docs**. Salve.
Cada vez que o robô salva algo, o Pages republica sozinho em ~1 minuto.

---

## Parte B — Teste de verdade (faça antes da virada)
1. Peça ao Gonçalinho para publicar uma matéria de teste no Blogger (ou publique você).
2. Abra o site novo. Em segundos deve aparecer o aviso "1 matéria nova do site original" (é o navegador buscando ao vivo).
3. Espere até 15 minutos e abra o site em uma **aba anônima**. A matéria deve estar lá sem aviso (o robô já salvou).
4. Copie o link `.../p/...html` dessa matéria e cole no WhatsApp: deve aparecer título e foto.

Se os 4 itens deram certo, está pronto.

---

## Parte C — Dia da virada (trocar o site antigo pelo novo)
1. **Domínio:** em Settings → Pages → **Custom domain**, escreva `ipaporanganoticias.com.br` e salve. O GitHub mostra quais registros DNS criar; quem gerencia o domínio (Registro.br, por exemplo) precisa apontar para o GitHub. Marque **Enforce HTTPS** quando liberar.
2. **Avise o robô do novo endereço:** no arquivo `docs/config.json`, preencha `"siteUrl": "https://ipaporanganoticias.com.br"`. No arquivo `.github/workflows/update.yml`, troque a linha `SITE_URL: https://...github.io/...` por `SITE_URL: https://ipaporanganoticias.com.br`. (Isso acerta as prévias do WhatsApp e o sitemap.)
3. **Links antigos:** já funcionam. Quem abrir um link do blog antigo (`/2026/11/titulo.html`, `/p/sobre-o-autor.html`, `/search/label/...`) é levado para a matéria equivalente no site novo.
4. **Blogger:** continue com o blog existindo (mesmo sem domínio próprio nele). É dele que as notícias saem.
5. Depois da virada, mande o link novo no WhatsApp e confira uma matéria no celular.

---

## Parte D — Rotina e problemas comuns
- **Uma vez por semana, olhe a aba Actions.** Deve ter bolinhas verdes recentes.
- **O GitHub pode pausar robôs agendados** em repositório sem nenhuma atividade por 60 dias. Se isso acontecer, entre em Actions e clique em **Enable workflow**. Mesmo pausado, o site continua mostrando as matérias novas pelo feed ao vivo.
- **"A matéria nova não aparece":** (1) confirme que ela está **publicada** no Blogger (não rascunho); (2) espere 10 a 15 minutos; (3) rode o robô na mão (Parte A, passo 3); (4) se continuar, me mande o link.
- **Matéria apagada ou corrigida no Blogger:** a correção é copiada na próxima rodada. Matéria **apagada** no Blogger continua no site até eu remover do arquivo de dados (me avise).
- **Quando eu mexer no site:** se você for subir arquivos novos, antes baixe as atualizações do robô (`git pull --rebase`), senão o GitHub reclama de conflito.

---

## Parte E — Perguntas frequentes
**Posso deixar o robô rodar de 1 em 1 minuto?** Não. O GitHub só aceita agendamento de no mínimo **5 em 5 minutos** e, na prática, atrasa alguns minutos. Por isso o robô ficou em 10 minutos. Para o leitor, a atualização parece imediata porque o navegador também busca ao vivo no Blogger. O robô só garante a prévia no WhatsApp, a busca e as editorias.

**Se eu subir arquivos novos, apaga as matérias?** As matérias ficam em `docs/data/posts.json`. Se você sobrescrever esse arquivo com uma cópia antiga, as matérias mais novas somem do arquivo, mas voltam na rodada seguinte do robô (ele baixa as 600 mais recentes do Blogger e junta). Para não ter surpresa, ao enviar mudanças **não substitua as pastas `docs/data` e `docs/p`**, ou rode o robô na mão depois.

**O robô apaga matérias antigas?** Não. Ele só acrescenta e atualiza. O limite é 600 matérias no arquivo (as mais recentes); acima disso as mais antigas saem da lista do site.

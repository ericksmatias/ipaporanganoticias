/* Ipaporanga Notícias — front-end estático para o Blogger.
 * Visual próprio (vidro, hero de noticiário, fontes livres). Desenvolvido por Erick Matias.
 *
 * Fontes de dados (nesta ordem):
 *   1. data/posts.json  – gerado por tools/fetch_feed.py (GitHub Action) ou tools/build_from_zip.py
 *   2. feed ao vivo do Blogger (JSONP) – acrescenta o que foi publicado depois do último JSON
 */
(function () {
  "use strict";

  var SCRIPT = document.currentScript;
  var ROOT = new URL("../../", SCRIPT.src).href; // raiz do site
  var ICONS = window.IPA_ICONS || {};
  var PAGE = document.body.getAttribute("data-page");

  var cfg = null;
  var posts = [];          // todos os posts conhecidos, mais novos primeiro
  var staticIds = {};      // ids que têm página de compartilhamento p/<id>.html
  var pagesData = {};
  var liveOk = false;

  /* ------------------------------------------------------------------ utilidades */
  function $(sel, el) { return (el || document).querySelector(sel); }
  function $$(sel, el) { return Array.prototype.slice.call((el || document).querySelectorAll(sel)); }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function fold(s) {
    return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  }
  function param(name) { return new URLSearchParams(location.search).get(name); }
  function fetchJSON(path) {
    return fetch(ROOT + path, { cache: "no-cache" }).then(function (r) {
      if (!r.ok) throw new Error(path + " " + r.status);
      return r.json();
    });
  }

  /* ------------------------------------------------------------------ datas */
  function dateParts(iso, opts) {
    try {
      var f = new Intl.DateTimeFormat("pt-BR", Object.assign({ timeZone: cfg.timezone }, opts));
      var o = {};
      f.formatToParts(new Date(iso)).forEach(function (p) { o[p.type] = p.value; });
      return o;
    } catch (e) { return {}; }
  }
  function fmtShort(iso) {
    var d = dateParts(iso, { day: "numeric", month: "long", year: "numeric" });
    var cur = dateParts(new Date().toISOString(), { year: "numeric" }).year;
    return d.day + " de " + d.month + (d.year !== cur ? " de " + d.year : "");
  }
  function fmtLong(iso) {
    var d = dateParts(iso, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    return d.day + " de " + String(d.month).replace(".", "") + " de " + d.year + ", " + d.hour + "h" + d.minute;
  }

  /* ------------------------------------------------------------------ imagens */
  function imgUrl(url, w) {
    if (!url) return "";
    url = url.replace(/^http:\/\//, "https://");
    if (!/googleusercontent\.com|bp\.blogspot\.com|ggpht\.com/.test(url)) return url;
    // .../s320/arquivo.jpg  |  .../w640-h480-c/arquivo.jpg  |  ...=s320
    var re = /\/(s\d+|w\d+(?:-h\d+)?(?:-[a-z]+)*)(-[a-z]+)*\/([^/]+)$/i;
    if (re.test(url)) return url.replace(re, "/w" + w + "/$3");
    if (/=[sw]\d+/.test(url)) return url.replace(/=[sw]\d+[^/]*$/, "=w" + w);
    return url;
  }
  function sameImage(a, b) {
    if (!a || !b) return false;
    var f = function (u) { return u.split("?")[0].split("/").slice(-1)[0]; };
    var pa = a.split("/"), pb = b.split("/");
    // o id longo (AVvX...) identifica a imagem no Blogger
    var ia = (a.match(/\/(AVv[^/]+)\//) || [])[1], ib = (b.match(/\/(AVv[^/]+)\//) || [])[1];
    return (ia && ib) ? ia === ib : f(a) === f(b);
  }

  /* ------------------------------------------------------------------ categorias */
  function catOf(p) {
    if (p._cat) return p._cat;
    var cats = cfg.categories, found = null;
    (p.labels || []).some(function (l) {
      var k = fold(l);
      return cats.some(function (c) {
        if (c.match.indexOf(k) > -1) { found = c; return true; }
        return false;
      });
    });
    p._cat = found || cats[cats.length - 1];
    return p._cat;
  }
  function catBySlug(slug) { return cfg.categories.filter(function (c) { return c.slug === slug; })[0]; }

  /* ------------------------------------------------------------------ links */
  function postHref(p) {
    return staticIds[p.id] ? "p/" + p.id.replace(/\//g, "-") + ".html" : "post.html?p=" + encodeURIComponent(p.id);
  }
  function catHref(slug) { return "categoria.html?c=" + encodeURIComponent(slug); }

  /* ------------------------------------------------------------------ dados ao vivo (JSONP) */
  function jsonp(url, timeout) {
    return new Promise(function (resolve, reject) {
      var cb = "__ipa" + Math.random().toString(36).slice(2);
      var s = document.createElement("script");
      var timer = setTimeout(function () { done(); reject(new Error("timeout")); }, timeout || 9000);
      function done() { clearTimeout(timer); delete window[cb]; if (s.parentNode) s.parentNode.removeChild(s); }
      window[cb] = function (d) { done(); resolve(d); };
      s.onerror = function () { done(); reject(new Error("erro de rede")); };
      s.src = url + (url.indexOf("?") > -1 ? "&" : "?") + "alt=json-in-script&callback=" + cb;
      document.head.appendChild(s);
    });
  }
  function idFromUrl(u) {
    var m = String(u).match(/^https?:\/\/[^/]+\/(\d{4}\/\d{2}\/[^?#]+?)(?:\.html)?(?:[?#].*)?$/);
    return m ? m[1] : null;
  }
  function entryToPost(en) {
    var href = "";
    (en.link || []).forEach(function (l) { if (l.rel === "alternate") href = l.href; });
    var id = idFromUrl(href);
    if (!id) return null;
    var body = (en.content && en.content.$t) || (en.summary && en.summary.$t) || "";
    var im = (body.match(/<img[^>]+src=["']([^"']+)["']/i) || [])[1] || (en["media$thumbnail"] && en["media$thumbnail"].url) || "";
    var text = (new DOMParser().parseFromString(body, "text/html").body.textContent || "").replace(/\s+/g, " ").trim();
    return {
      id: id,
      title: en.title.$t.trim(),
      published: en.published.$t,
      updated: en.updated.$t,
      author: (en.author && en.author[0] && en.author[0].name.$t) || "",
      labels: (en.category || []).map(function (c) { return c.term; }),
      image: im,
      excerpt: text.length > 220 ? text.slice(0, 220).replace(/\s+\S*$/, "") + "…" : text,
      html: body,
      _live: true
    };
  }
  function mergePosts(list) {
    var map = {};
    posts.forEach(function (p) { map[p.id] = p; });
    var added = 0;
    list.forEach(function (p) { if (!map[p.id]) added++; map[p.id] = Object.assign(map[p.id] || {}, p); });
    posts = Object.keys(map).map(function (k) { return map[k]; });
    posts.sort(function (a, b) { return a.published < b.published ? 1 : -1; });
    return added;
  }
  function liveLatest(n) {
    if (!cfg.liveFeed) return Promise.reject(new Error("desativado"));
    var url = cfg.feedBase + "/posts/default?orderby=published&max-results=" + (n || 30);
    return jsonp(url).then(function (d) {
      liveOk = true;
      return ((d.feed && d.feed.entry) || []).map(entryToPost).filter(Boolean);
    });
  }
  function liveOne(id) {
    function pick(d) {
      var list = ((d.feed && d.feed.entry) || []).map(entryToPost).filter(Boolean);
      var p = list.filter(function (x) { return x.id === id; })[0];
      if (!p) throw new Error("não encontrado");
      return p;
    }
    var base = cfg.feedBase + "/posts/default?";
    return jsonp(base + "path=" + encodeURIComponent("/" + id + ".html")).then(pick).catch(function () {
      // plano B: busca pelas palavras do endereço da matéria
      var slug = id.split("/").pop().replace(/-/g, " ");
      return jsonp(base + "max-results=10&q=" + encodeURIComponent(slug)).then(pick);
    });
  }

  /* ------------------------------------------------------------------ saneamento do corpo da matéria */
  var INLINE = /^(A|B|STRONG|I|EM|U|SPAN|SMALL|SUP|SUB|MARK|FONT|BR|S|STRIKE|DEL|INS|CODE|ABBR|CITE)$/;
  var KEEP_ATTR = { href: 1, src: 1, alt: 1, title: 1, target: 1, allowfullscreen: 1, allow: 1, frameborder: 1, colspan: 1, rowspan: 1, loading: 1, referrerpolicy: 1 };

  function cleanNode(el) {
    $$("script,style,link,meta,object,embed,form,noscript,input,button,textarea,select", el).forEach(function (n) { n.remove(); });
    $$("*", el).forEach(function (n) {
      Array.prototype.slice.call(n.attributes).forEach(function (a) {
        var k = a.name.toLowerCase();
        if (!KEEP_ATTR[k]) n.removeAttribute(a.name);
      });
      if (n.tagName === "A") {
        var h = (n.getAttribute("href") || "").trim();
        if (/^\s*(javascript|data|vbscript):/i.test(h)) n.removeAttribute("href");
        var im = h.match(/^https?:\/\/(?:www\.)?ipaporanganoticias\.com\.br\/(\d{4}\/\d{2}\/[^?#]+?)(?:\.html)?(?:[?#].*)?$/i);
        if (im) { n.setAttribute("href", postHref({ id: im[1] })); n.removeAttribute("target"); }
        else if (n.getAttribute("href")) { n.setAttribute("rel", "noopener noreferrer"); if (!/^#/.test(h)) n.setAttribute("target", "_blank"); }
      }
      if (n.tagName === "IMG") {
        var s = n.getAttribute("src") || "";
        if (!/^(https?:)?\/\//i.test(s)) { n.remove(); return; }
        n.setAttribute("src", imgUrl(s, 1600));
        n.setAttribute("loading", "lazy");
        n.setAttribute("decoding", "async");
        n.setAttribute("alt", n.getAttribute("alt") || "");
      }
      if (n.tagName === "IFRAME") {
        var u = n.getAttribute("src") || "";
        if (!/^(https?:)?\/\//i.test(u)) { n.remove(); return; }
        n.setAttribute("loading", "lazy");
        n.setAttribute("referrerpolicy", "no-referrer-when-downgrade");
        n.setAttribute("allowfullscreen", "");
      }
    });
    // <font> -> conteúdo puro
    $$("font", el).forEach(function (f) { f.replaceWith.apply(f, Array.prototype.slice.call(f.childNodes)); });
  }

  function blankHTML(h) { return !h.replace(/<br\s*\/?>|&nbsp;|\s| /gi, "").replace(/<[^>]+>/g, "").trim(); }

  function buildBody(html) {
    var doc = new DOMParser().parseFromString("<div id=\"r\">" + html + "</div>", "text/html");
    var root = doc.getElementById("r");
    cleanNode(root);
    var out = document.createElement("div");
    var run = [];

    function flush() {
      if (!run.length) return;
      var holder = document.createElement("div");
      run.forEach(function (n) { holder.appendChild(n.cloneNode(true)); });
      run = [];
      var parts = holder.innerHTML.split(/(?:<br\s*\/?>\s*){2,}/i);
      parts.forEach(function (part) {
        part = part.replace(/^(?:\s|&nbsp;|<br\s*\/?>)+|(?:\s|&nbsp;|<br\s*\/?>)+$/gi, "");
        if (blankHTML(part)) return;
        var p = document.createElement("p");
        p.className = "ipa-p";
        p.innerHTML = part;
        out.appendChild(p);
      });
    }
    function media(el) {
      $$("img", el).forEach(function (img) {
        var fig = document.createElement("figure");
        fig.className = "ipa-fig";
        fig.appendChild(img.cloneNode(true));
        var cap = el.querySelector && el.querySelector("figcaption, .tr-caption");
        if (cap && cap.textContent.trim() && $$("img", el).length === 1) {
          var fc = document.createElement("figcaption"); fc.textContent = cap.textContent.trim(); fig.appendChild(fc);
        }
        out.appendChild(fig);
      });
      $$("iframe", el).forEach(function (fr) {
        var box = document.createElement("figure");
        box.className = "embed";
        box.appendChild(fr.cloneNode(true));
        out.appendChild(box);
      });
    }
    function walk(parent) {
      Array.prototype.slice.call(parent.childNodes).forEach(function (n) {
        if (n.nodeType === 3) { run.push(n); return; }
        if (n.nodeType !== 1) return;
        var tag = n.tagName;
        if (tag === "IMG" || tag === "IFRAME") { flush(); media({ querySelectorAll: function (s) { return [n].filter(function (x) { return x.matches(s); }); }, querySelector: function () { return null; } }); return; }
        if (tag === "A" && n.querySelector("img") && !n.textContent.trim()) { flush(); media(n); return; }
        if (INLINE.test(tag)) {
          if (n.querySelector("img,iframe")) { flush(); media(n); var t = n.cloneNode(true); $$("img,iframe", t).forEach(function (x) { x.remove(); }); if (t.textContent.trim()) run.push(t); }
          else run.push(n);
          return;
        }
        if (/^H[1-6]$/.test(tag)) { flush(); var h = document.createElement("h4"); h.innerHTML = n.innerHTML; if (h.textContent.trim()) out.appendChild(h); return; }
        if (tag === "UL" || tag === "OL" || tag === "BLOCKQUOTE" || tag === "TABLE") {
          flush();
          if (tag === "TABLE" && n.querySelector("img") && !n.textContent.replace(/\s+/g, "").length) { media(n); return; }
          out.appendChild(n.cloneNode(true)); return;
        }
        // DIV, P, SECTION, CENTER, FIGURE...
        if (n.querySelector("img,iframe")) {
          flush();
          // separa imagens do texto vizinho dentro do mesmo bloco
          var txt = n.cloneNode(true);
          $$("img,iframe", txt).forEach(function (x) { x.remove(); });
          if (!txt.textContent.trim()) { media(n); return; }
          walk(n); flush(); return;
        }
        flush(); walk(n); flush();
      });
    }
    walk(root);
    flush();
    return out;
  }

  /* ------------------------------------------------------------------ componentes */
  function placeholder() {
    return '<div class="ph"><span>' + esc(cfg.siteName.split(" ")[0]) + "<i>_</i></span></div>";
  }
  window.IPA_PH = "";
  function pic(p, w) {
    var im = p.image ? imgUrl(p.image, w) : "";
    return im
      ? '<img src="' + esc(im) + '" alt="" loading="lazy" decoding="async" onerror="this.outerHTML=IPA_PH">'
      : placeholder();
  }
  function ago(iso) {
    var s = (Date.now() - new Date(iso).getTime()) / 1000;
    if (s < 0 || isNaN(s)) return fmtShort(iso);
    if (s < 3600) return "há " + Math.max(1, Math.round(s / 60)) + " min";
    if (s < 86400) return "há " + Math.round(s / 3600) + " h";
    if (s < 172800) return "ontem";
    return fmtShort(iso);
  }
  function tag(p) { return '<span class="tag">' + esc(catOf(p).name) + "</span>"; }
  function meta(p) { return '<span class="meta">' + esc(ago(p.published)) + (p.author ? " · " + esc(p.author.replace(/\.$/, "")) : "") + "</span>"; }
  function card(p, d) {
    return '<a class="card rv" style="--d:' + (d || 0) + 's" href="' + esc(postHref(p)) + '" title="' + esc(p.title) + '"><div class="im">' + pic(p, 640) + tag(p) +
      '</div><div class="bd"><h3>' + esc(p.title) + "</h3>" + meta(p) + "</div></a>";
  }
  function tile(p, big) {
    var im = p.image ? imgUrl(p.image, big ? 1400 : 800) : "";
    return '<a class="tile rv' + (big ? " big" : "") + '" href="' + esc(postHref(p)) + '" title="' + esc(p.title) + '"><div class="bg">' +
      (im ? '<img src="' + esc(im) + '" alt="" loading="lazy" decoding="async" onerror="this.outerHTML=IPA_PH">' : placeholder()) +
      '</div><div class="in">' + tag(p) + "<h3>" + esc(p.title) + "</h3>" +
      (big && p.excerpt ? '<p class="ex">' + esc(p.excerpt) + "</p>" : "") + meta(p) +
      (big ? '<span class="glassbar glass">Ler matéria ' + ICONS.arrow.replace("<svg", '<svg width="16" height="16"') + "</span>" : "") + "</div></a>";
  }
  function secHead(eyebrow, title, href, more) {
    return '<div class="sec-head rv"><div><span class="hat eyebrow">' + esc(eyebrow) + "</span><h2>" + title + "</h2></div>" +
      (href ? '<a class="more" href="' + esc(href) + '">' + esc(more || "Ver tudo") + " →</a>" : "") + "</div>";
  }

  /* ------------------------------------------------------------------ cabeçalho / rodapé */
  function socialList() {
    var s = cfg.social || {}, items = [];
    if (cfg.whatsapp) items.push(["WhatsApp", cfg.whatsapp, ICONS.whatsapp]);
    if (s.instagram) items.push(["Instagram", s.instagram, ICONS.instagram]);
    if (s.facebook) items.push(["Facebook", s.facebook, ICONS.facebook]);
    return '<div class="social">' + items.map(function (i) {
      return '<a target="_blank" rel="noopener noreferrer" href="' + esc(i[1]) + '" title="' + i[0] + '" aria-label="' + i[0] + '">' + i[2] + "</a>";
    }).join("") + "</div>";
  }
  function here(href) {
    var cur = location.pathname.split("/").pop() + location.search;
    return href !== "index.html" && cur.indexOf(href) > -1;
  }
  function menuItems() {
    var items = [["Início", "index.html"]];
    cfg.categories.forEach(function (c) { items.push([c.name, catHref(c.slug)]); });
    items.push(["Sobre", "pagina.html?p=sobre-o-autor"]);
    return items;
  }
  function renderChrome() {
    var h = $("#app-header");
    if (h) {
      var items = menuItems();
      h.innerHTML =
        '<header class="nav" id="ipaNav"><div class="wrap">' +
        '<a class="nav-logo" href="index.html" aria-label="Ipaporanga Notícias — início"><img src="assets/img/logo-light.png" alt="Ipaporanga Notícias" width="104" height="40"></a>' +
        '<nav class="nav-links" aria-label="Principal">' + items.slice(1).map(function (i) {
          return '<a href="' + esc(i[1]) + '"' + (here(i[1]) ? ' class="is-active"' : "") + ">" + esc(i[0]) + "</a>";
        }).join("") + "</nav>" +
        '<div class="nav-tools"><button class="icon-btn" id="ipaSearchBtn" type="button" aria-label="Buscar" aria-expanded="false">' + ICONS.search + "</button>" +
        (cfg.whatsapp ? '<a class="btn btn-red nav-wa" target="_blank" rel="noopener" href="' + esc(cfg.whatsapp) + '">' + ICONS.whatsapp + "Redação</a>" : "") +
        '<button class="icon-btn" id="ipaMenuBtn" type="button" aria-label="Menu" aria-controls="ipaSheet" aria-expanded="false">' + ICONS.menu + "</button></div>" +
        '</div><div class="progress" id="ipaProg"></div></header>' +
        '<div class="searchbar" id="ipaSearch"><div class="wrap"><form action="categoria.html" method="GET" role="search"><input type="search" name="q" placeholder="Buscar notícias…" aria-label="Buscar" value="' + esc(param("q") || "") + '" autocomplete="off"><button class="btn btn-red" type="submit">Buscar</button></form></div></div>' +
        '<div class="sheet-back" id="ipaBack"></div>' +
        '<aside class="sheet" id="ipaSheet" aria-hidden="true" aria-label="Menu"><div class="sheet-head"><img src="assets/img/logo-light.png" alt="Ipaporanga Notícias"><button class="icon-btn" id="ipaClose" type="button" aria-label="Fechar">' + ICONS.close + "</button></div>" +
        "<nav>" + items.map(function (i, n) {
          return '<a href="' + esc(i[1]) + '"' + (here(i[1]) ? ' class="is-active"' : "") + ">" + esc(i[0]) + "<i>0" + (n + 1) + "</i></a>";
        }).join("") + (cfg.whatsapp ? '<a href="' + esc(cfg.whatsapp) + '" target="_blank" rel="noopener">Fale conosco<i>↗</i></a>' : "") + "</nav>" +
        '<div class="sheet-foot">' + socialList() + "</div></aside>";

      var nav = $("#ipaNav"), sheet = $("#ipaSheet"), back = $("#ipaBack"), sb = $("#ipaSearch"), sbtn = $("#ipaSearchBtn"), mbtn = $("#ipaMenuBtn");
      var toggle = function (open) {
        sheet.classList.toggle("show", open); back.classList.toggle("show", open);
        sheet.setAttribute("aria-hidden", open ? "false" : "true"); mbtn.setAttribute("aria-expanded", open ? "true" : "false");
        document.body.classList.toggle("ipa-lock", open);
      };
      var search = function (open) {
        sb.classList.toggle("show", open); sbtn.setAttribute("aria-expanded", open ? "true" : "false");
        if (open) { nav.classList.add("is-scrolled"); setTimeout(function () { $("input", sb).focus(); }, 250); } else onScroll();
      };
      mbtn.addEventListener("click", function () { toggle(true); });
      $("#ipaClose").addEventListener("click", function () { toggle(false); });
      back.addEventListener("click", function () { toggle(false); });
      sbtn.addEventListener("click", function () { search(!sb.classList.contains("show")); });
      document.addEventListener("keydown", function (e) { if (e.key === "Escape") { toggle(false); search(false); } });
    }
    var f = $("#app-footer");
    if (f) {
      f.innerHTML =
        '<footer class="foot"><div class="wrap"><div class="foot-grid">' +
        '<div><img class="fl" src="assets/img/logo-light.png" alt="Ipaporanga Notícias"><p class="tagline">' + esc(cfg.tagline) + ". Polícia, política e comunidade, com informação de quem está na rua.</p>" +
        (cfg.whatsapp ? '<a class="btn btn-red" target="_blank" rel="noopener" href="' + esc(cfg.whatsapp) + '">' + ICONS.whatsapp + "Fale com a redação</a>" : "") + "</div>" +
        '<div><h4>Editorias</h4><ul>' + cfg.categories.map(function (c) { return '<li><a href="' + esc(catHref(c.slug)) + '">' + esc(c.name) + "</a></li>"; }).join("") +
        "</ul></div>" +
        "<div><h4>Siga</h4>" + socialList() + '<h4 style="margin-top:1.6rem">Institucional</h4><ul><li><a href="pagina.html?p=sobre-o-autor">Sobre</a></li><li><a href="pagina.html?p=privacidade-sua-privacidade-e">Política de privacidade</a></li><li><a href="pagina.html?p=termos-de-uso">Termos de uso</a></li></ul></div>' +
        '</div><div class="foot-bottom"><span>© ' + new Date().getFullYear() + " " + esc(cfg.siteName) + ". Todos os direitos reservados.</span>" +
        '<span class="dev">Desenvolvido por <b>Erick Matias</b></span></div></div></footer><div class="toast" id="ipaStatus" role="status"></div>';
    }
  }
  function status(msg, ms) {
    var s = $("#ipaStatus"); if (!s) return;
    s.textContent = msg; s.classList.add("show");
    clearTimeout(status.t); status.t = setTimeout(function () { s.classList.remove("show"); }, ms || 3500);
  }

  /* ------------------------------------------------------------------ rolagem: vidro, parallax, revelar */
  var navEl = null, heroEl = null, ticking = false;
  function onScroll() {
    ticking = false;
    var y = window.scrollY || 0;
    navEl = navEl || $("#ipaNav");
    if (navEl && !($("#ipaSearch") && $("#ipaSearch").classList.contains("show"))) navEl.classList.toggle("is-scrolled", y > 24);
    if (heroEl) heroEl.style.setProperty("--p", Math.min(1, Math.max(0, y / (heroEl.offsetHeight * .8))).toFixed(3));
    var art = $("#ipaBody");
    if (art && navEl) {
      var r = art.getBoundingClientRect(), tot = r.height - window.innerHeight * .6;
      navEl.style.setProperty("--read", Math.min(1, Math.max(0, (-r.top + window.innerHeight * .3) / Math.max(tot, 1))).toFixed(3));
      var p = $("#ipaProg"); if (p) p.style.setProperty("--read", navEl.style.getPropertyValue("--read"));
    }
  }
  function bindScroll() {
    window.addEventListener("scroll", function () { if (!ticking) { ticking = true; requestAnimationFrame(onScroll); } }, { passive: true });
    onScroll();
  }
  var io = null;
  function reveal() {
    var els = $$(".rv:not(.in)");
    if (!("IntersectionObserver" in window)) { els.forEach(function (e) { e.classList.add("in"); }); return; }
    io = io || new IntersectionObserver(function (en) {
      en.forEach(function (x) { if (x.isIntersecting) { x.target.classList.add("in"); io.unobserve(x.target); } });
    }, { rootMargin: "0px 0px -8% 0px", threshold: .05 });
    els.forEach(function (e) { io.observe(e); });
  }

  /* ------------------------------------------------------------------ páginas */
  function setTitle(t) { document.title = t ? t + " | " + cfg.siteName : cfg.siteName + " — " + cfg.tagline; }
  function pageTop(eyebrow, title, sub, chips) {
    return '<section class="page-top"><div class="wrap"><span class="hat" style="color:var(--red-2)">' + esc(eyebrow) + "</span><h1>" + esc(title) + "</h1>" + (sub ? "<p>" + esc(sub) + "</p>" : "") +
      (chips ? '<div class="chips">' + chips + "</div>" : "") + "</div></section>";
  }
  function emptyBox(h, p, btn) { return '<div class="wrap empty"><h1>' + esc(h) + "</h1><p>" + esc(p) + "</p>" + (btn || "") + "</div>"; }

  function startClock() {
    var el = $("#ipaClock"); if (!el) return;
    var tick = function () {
      try { el.textContent = new Intl.DateTimeFormat("pt-BR", { timeZone: cfg.timezone, hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).format(new Date()); } catch (e) {}
    };
    tick(); setInterval(tick, 1000);
  }

  function renderHome() {
    var app = $("#app");
    if (!posts.length) { app.innerHTML = emptyBox("Sem matérias por aqui", "Não consegui carregar as notícias agora. Tente novamente em instantes.", '<a class="btn btn-red" href="index.html">Tentar de novo</a>'); return; }
    var top = posts[0], lead = posts.slice(1, 4), latest = posts.slice(4, 12), rest = posts.slice(12);
    var tk = posts.slice(0, 10).map(function (p) { return '<a href="' + esc(postHref(p)) + '"><b>' + esc(catOf(p).name) + "</b>" + esc(p.title) + "</a>"; }).join("");
    var tim = top.image ? imgUrl(top.image, 900) : "";
    var h =
      '<section class="hero" id="ipaHero"><canvas id="ipaFx" aria-hidden="true"></canvas><div class="hero-scan"></div>' +
      '<div class="wrap hero-inner"><div>' +
      '<div class="hud mono"><span class="rec"><i></i>Ao vivo</span><span>Sinal ativo <b id="ipaClock">--:--:--</b></span><span>Sertão de Crateús · Vale do Acaraú</span></div>' +
      '<h1><span>Ipaporanga</span><span class="l2">e região</span><span><em class="glitch" data-t="em foco" style="font-style:normal">em foco</em><b class="blink" style="color:var(--red-2);font-weight:800">_</b></span></h1>' +
      '<p class="hero-sub">Polícia, política e o que acontece nas cidades do Sertão, contado por quem está na rua. Atualizado o dia todo.</p>' +
      '<div class="hero-cta"><a class="btn btn-red" href="#ultimas">Últimas notícias ' + ICONS.arrow + "</a>" +
      (cfg.whatsapp ? '<a class="btn btn-glass" target="_blank" rel="noopener" href="' + esc(cfg.whatsapp) + '">' + ICONS.whatsapp + "Envie uma pauta</a>" : "") + "</div></div>" +
      '<a class="hero-card glass" href="' + esc(postHref(top)) + '" title="' + esc(top.title) + '"><i class="corner tl"></i><i class="corner tr"></i><i class="corner bl"></i><i class="corner br"></i>' +
      '<div class="im">' + (tim ? '<img src="' + esc(tim) + '" alt="" fetchpriority="high" decoding="async" onerror="this.outerHTML=IPA_PH">' : placeholder()) + '<span class="tag">' + esc(catOf(top).name) + '</span></div>' +
      '<div class="bd"><span class="mono">Última hora · ' + esc(ago(top.published)) + "</span><h2>" + esc(top.title) + '</h2><span class="mono">Ler matéria →</span></div></a>' +
      '</div><div class="ticker glass"><div class="lbl"><i></i>Agora</div><div class="belt"><div class="run">' + tk + tk + "</div></div></div>" +
      '<span class="cue" aria-hidden="true"><i></i></span></section>' +

      '<section class="sec" id="ultimas"><div class="wrap">' + secHead("Em destaque", "Manchetes <em>do dia</em>") +
      '<div class="lead">' + (lead[0] ? tile(lead[0], true) : "") + (lead[1] ? tile(lead[1]) : "") + (lead[2] ? tile(lead[2]) : "") + "</div></div></section>" +

      (latest.length ? '<section class="sec" style="padding-top:0"><div class="wrap">' + secHead("Fluxo", "Últimas <em>notícias</em>", "categoria.html", "Todas") +
        '<div class="grid">' + latest.map(function (p, i) { return card(p, (i % 4) * .06); }).join("") + "</div></div></section>" : "");

    var dark = true;
    cfg.categories.forEach(function (c) {
      if (c.slug === "geral") return;
      var list = posts.filter(function (p) { return catOf(p).slug === c.slug; }).slice(0, 4);
      if (!list.length) return;
      h += '<section class="sec' + (dark ? " dark" : "") + '"><div class="wrap">' + secHead("Editoria", esc(c.name), catHref(c.slug), "Ver editoria") +
        '<div class="rail">' + list.map(function (p, i) { return card(p, i * .07); }).join("") + "</div></div></section>";
      dark = !dark;
    });
    h += '<section class="sec"><div class="wrap"><div class="cta rv"><span class="hat" style="color:var(--red-2)">Redação aberta</span><h2>Viu algo? <em>Manda pra gente.</em></h2><p>Fotos, vídeos e informações chegam direto à redação do ' + esc(cfg.siteName) + ".</p>" +
      (cfg.whatsapp ? '<a class="btn btn-red" target="_blank" rel="noopener" href="' + esc(cfg.whatsapp) + '">' + ICONS.whatsapp + "Falar no WhatsApp</a>" : "") + "</div></div></section>";
    if (rest.length) h += '<section class="sec" style="padding-top:0"><div class="wrap">' + secHead("Arquivo recente", "Mais <em>matérias</em>") + '<div class="grid" id="ipaList"></div><div class="more-wrap"><button type="button" class="btn btn-line" id="ipaMore">Carregar mais matérias</button></div></div></section>';
    app.innerHTML = h;
    heroEl = $("#ipaHero");
    if (rest.length) pager(rest);
    startClock(); reveal(); onScroll(); setTitle("");
  }
  function pager(items) {
    var shown = 0, size = cfg.pageSize || 12, box = $("#ipaList"), more = $("#ipaMore");
    function add() {
      var chunk = items.slice(shown, shown + size);
      box.insertAdjacentHTML("beforeend", chunk.map(function (p, i) { return card(p, (i % 4) * .05); }).join(""));
      shown += chunk.length;
      if (shown >= items.length) more.parentNode.style.display = "none";
      reveal();
    }
    add(); more.addEventListener("click", add);
  }

  function renderListing() {
    var app = $("#app");
    var slug = param("c"), q = (param("q") || "").trim(), label = param("l");
    var c = slug && catBySlug(slug), items, title, sub;
    if (q) {
      var words = q.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").split(/\s+/).filter(Boolean);
      items = posts.filter(function (p) {
        var hay = (p.title + " " + (p.excerpt || "") + " " + (p.labels || []).join(" ")).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
        return words.every(function (w) { return hay.indexOf(w) > -1; });
      });
      title = "Busca: " + q; sub = items.length + (items.length === 1 ? " resultado" : " resultados") + " nas matérias carregadas";
    } else if (label) {
      var lk = fold(label);
      items = posts.filter(function (p) { return (p.labels || []).some(function (l) { return fold(l) === lk; }); });
      title = label; sub = items.length + " matérias";
    } else if (c) {
      items = posts.filter(function (p) { return catOf(p).slug === c.slug; });
      title = c.name; sub = items.length + " matérias carregadas";
    } else { items = posts; title = "Todas as matérias"; sub = items.length + " matérias carregadas"; }
    var chips = cfg.categories.map(function (k) { return '<a class="chip' + (c && c.slug === k.slug ? " on" : "") + '" href="' + esc(catHref(k.slug)) + '">' + esc(k.name) + "</a>"; }).join("");
    var h = pageTop(q ? "Pesquisa" : "Editoria", title, sub, chips);
    if (!items.length) {
      h += emptyBox("Nada encontrado", "Tente outra palavra ou veja as últimas notícias.", '<a class="btn btn-red" href="index.html">Voltar ao início</a>');
      app.innerHTML = h; setTitle(title); onScroll(); return;
    }
    h += '<div class="list-main"><div class="wrap"><div class="grid" id="ipaList"></div><div class="more-wrap"><button type="button" class="btn btn-line" id="ipaMore">Carregar mais</button></div>' + "</div></div>";
    app.innerHTML = h;
    pager(items); reveal(); onScroll(); setTitle(title);
  }

  function shareLinks(p) {
    var base = cfg.siteUrl ? cfg.siteUrl.replace(/\/$/, "") + "/p/" + p.id.replace(/\//g, "-") + ".html" : location.href.split("#")[0];
    var u = encodeURIComponent(base), t = encodeURIComponent(p.title);
    function a(href, title, icon) { return '<a target="_blank" rel="noopener noreferrer" href="' + href + '" title="' + title + '" aria-label="' + title + '">' + icon + "</a>"; }
    return '<div class="share">' +
      a("https://api.whatsapp.com/send?text=" + t + "%20-%20" + u, "Compartilhar no WhatsApp", ICONS.whatsapp) +
      a("https://www.facebook.com/sharer/sharer.php?u=" + u, "Compartilhar no Facebook", ICONS.facebook) +
      a("https://twitter.com/intent/tweet?text=" + t + "&url=" + u, "Compartilhar no X", ICONS.x) +
      '<a href="' + esc(base) + '" data-copy="' + esc(base) + '" title="Copiar link" aria-label="Copiar link">' + ICONS.link + "</a></div>";
  }

  function renderPost(p) {
    var app = $("#app"), c = catOf(p), body = buildBody(p.html || "");
    var hero = p.image || "", first = body.firstElementChild;
    if (first && first.tagName === "FIGURE" && first.querySelector("img")) {
      var src = first.querySelector("img").getAttribute("src");
      if (!hero || sameImage(src, hero)) { hero = src; first.remove(); }
    }
    var heroImg = hero ? imgUrl(hero, 1600) : "";
    var related = posts.filter(function (x) { return x.id !== p.id && catOf(x).slug === c.slug; }).slice(0, 4);
    if (related.length < 4) related = related.concat(posts.filter(function (x) { return x.id !== p.id && related.indexOf(x) < 0; }).slice(0, 4 - related.length));
    var labels = [];
    (p.labels || []).forEach(function (l) { var k = fold(l); if (k && labels.every(function (x) { return fold(x) !== k; })) labels.push(l); });
    var h = '<article><header class="art-hero' + (heroImg ? "" : " none") + '" id="ipaHero">' +
      (heroImg ? '<div class="bg" id="ipaHeroBg"><img id="ipaHeroImg" alt="' + esc(p.title) + '" src="' + esc(heroImg) + '" fetchpriority="high" decoding="async"></div>' : "") +
      '<div class="wrap"><a class="tag" href="' + esc(catHref(c.slug)) + '" style="text-decoration:none">' + esc(c.name) + "</a><h1>" + esc(p.title) + "</h1>" +
      '<div class="byline">' + (p.author ? "<span>Por <a href=\"pagina.html?p=sobre-o-autor\">" + esc(p.author.replace(/\.$/, "")) + "</a></span>" : "") +
      '<time class="mono" datetime="' + esc(p.published) + '">' + esc(fmtLong(p.published)) + "</time></div></div></header>" +
      '<div class="wrap art">' + shareLinks(p) + '<div><div class="prose" id="ipaBody"></div>' +
      '<div class="themes"><a href="' + esc(catHref(c.slug)) + '">' + esc(c.name) + "</a>" +
      labels.filter(function (l) { return !c.match.some(function (m) { return fold(l) === m; }); }).map(function (l) { return '<a href="categoria.html?l=' + encodeURIComponent(l) + '">' + esc(l.replace(/\.$/, "")) + "</a>"; }).join("") + "</div></div></div>" +
      '<section class="related"><div class="wrap"><h2>Leia também</h2><div class="grid">' + related.map(function (x, i) { return card(x, i * .06); }).join("") + "</div></div></section>" +
      (cfg.whatsapp ? '<section class="sec" style="padding-top:0"><div class="wrap"><div class="cta rv"><span class="hat" style="color:var(--red-2)">Redação</span><h2>Tem uma <em>pauta ou denúncia?</em></h2><p>Envie fotos, vídeos e informações direto para a redação do ' + esc(cfg.siteName) + '.</p><a class="btn btn-red" target="_blank" rel="noopener" href="' + esc(cfg.whatsapp) + '">' + ICONS.whatsapp + "Falar no WhatsApp</a></div></div></section>" : "") + "</article>";
    app.innerHTML = h;
    $("#ipaBody").appendChild(body);
    if (!body.children.length) $("#ipaBody").innerHTML = '<p class="ipa-p">Esta matéria está sem texto.</p>';
    heroEl = $("#ipaHero");
    var im = $("#ipaHeroImg");
    if (im) {
      var fit = function () {
        if (im.naturalWidth && im.naturalWidth < 1100) { var s = $("#ipaHero"); s.classList.add("contain"); $("#ipaHeroBg").style.backgroundImage = 'url("' + im.currentSrc.replace(/"/g, "") + '")'; }
      };
      if (im.complete) fit(); else im.addEventListener("load", fit);
      im.addEventListener("error", function () { var b = $("#ipaHeroBg"); if (b) b.remove(); $("#ipaHero").classList.add("none"); });
    }
    $$("[data-copy]").forEach(function (b) {
      b.addEventListener("click", function (ev) {
        ev.preventDefault();
        var u = b.getAttribute("data-copy");
        (navigator.clipboard ? navigator.clipboard.writeText(u) : Promise.reject()).then(function () { status("Link copiado"); }, function () { window.prompt("Copie o link:", u); });
      });
    });
    reveal(); onScroll();
    document.title = p.title + " | " + cfg.siteName;
  }

  function renderPostError(id) {
    $("#app").innerHTML = pageTop("Erro 404", "Matéria não encontrada", "Ela pode ter sido removida ou o endereço está incorreto.") +
      emptyBox("", "", '<a class="btn btn-red" href="index.html">Voltar ao início</a>');
    setTitle("Matéria não encontrada");
  }

  function renderAbout(pg) {
    var avatar = (pg.html.match(/<img[^>]+src=["']([^"']+)["']/i) || [])[1] || "";
    var h = '<section class="page-top"><div class="wrap">' +
      (avatar ? '<img class="avatar" alt="Gonçalinho Rodrigues" src="' + esc(imgUrl(avatar, 208)) + '">' : "") +
      '<span class="hat" style="color:var(--red-2);display:block;margin-top:1.2rem">Sobre o autor</span><h1>Gonçalinho<br>Rodrigues</h1>' +
      "<p>Radialista, repórter e editor do Ipaporanga Notícias.</p></div></section>" +
      '<div class="wrap about"><div>' +
      '<p class="lede"><strong>Gonçalinho Rodrigues</strong> é radialista sindicalizado, natural de Ipaporanga, e a voz por trás do Ipaporanga Notícias. Hoje apresenta o programa <strong>Plenário do Povo</strong> na Rádio Rio Acaraú FM 94,3, em Tamboril/CE.</p>' +
      "<p>O blog acompanha o dia a dia de Ipaporanga e das cidades vizinhas: fatos policiais, política e acontecimentos das comunidades do Sertão de Crateús e do Vale do Acaraú. As matérias são assinadas por ele.</p>" +
      "<p>Segundo o próprio autor, o trabalho é pautado na transparência, na imparcialidade e no compromisso com leitores e ouvintes.</p>" +
      (cfg.whatsapp ? '<div style="margin-top:1.8rem;display:flex;gap:.7rem;flex-wrap:wrap"><a class="btn btn-red" target="_blank" rel="noopener" href="' + esc(cfg.whatsapp) + '">' + ICONS.whatsapp + 'Falar com o Gonçalinho</a><a class="btn btn-line" href="categoria.html">Ler as matérias ' + ICONS.arrow + "</a></div>" : "") +
      '</div><aside class="facts"><div class="fact rv"><span class="hat">No ar</span><strong>Plenário do Povo</strong><p>Segunda a sábado, das 12h às 14h30, na Rádio Rio Acaraú FM 94,3 (Tamboril/CE).</p></div>' +
      '<div class="fact rv"><span class="hat">Trajetória no rádio</span><ul class="timeline">' +
      "<li><b>FM Águas Belas</b><span>Ipaporanga (emissora extinta)</span></li><li><b>Rádio Vox FM</b><span>Ipueiras</span></li><li><b>Rádio Plus FM</b><span>Crateús</span></li><li><b>Rádio Rio Acaraú FM 94,3</b><span>Tamboril/CE — atualmente</span></li></ul></div>" +
      '<div class="fact rv"><span class="hat">Cobertura</span><strong>Ipaporanga e região</strong><p>Tamboril, Nova Russas, Poranga, Crateús, Novo Oriente, Ararendá e arredores.</p></div></aside></div>';
    $("#app").innerHTML = h;
    reveal(); onScroll(); setTitle("Sobre o autor");
  }

  function renderStaticPage() {
    var id = param("p") || "", pg = (window.IPA_LEGAL && window.IPA_LEGAL[id]) || pagesData[id], app = $("#app");
    if (!pg) {
      app.innerHTML = pageTop("Erro 404", "Página não encontrada", "Essa página não existe aqui.") + emptyBox("", "", '<a class="btn btn-red" href="index.html">Voltar para o início</a>');
      setTitle("Página não encontrada"); return;
    }
    if (id === "sobre-o-autor") return renderAbout(pg);
    if (window.IPA_LEGAL && window.IPA_LEGAL[id]) pg = window.IPA_LEGAL[id];
    var legal = window.IPA_LEGAL && window.IPA_LEGAL[id];
    app.innerHTML = pageTop("Institucional", pg.title, "") + '<main class="list-main"><div class="wrap" style="max-width:820px"><div class="prose' + (legal ? " legal" : "") + '" id="ipaBody"></div></div></main>';
    if (legal) $("#ipaBody").innerHTML = pg.html; else $("#ipaBody").appendChild(buildBody(pg.html.replace(/<h1[^>]*>.*?<\/h1>/i, "")));
    setTitle(pg.title); onScroll();
  }

  /* Links antigos do Blogger (ipaporanganoticias.com.br) -> endereço equivalente neste site. */
  function oldLinkTarget() {
    var path = decodeURIComponent(location.pathname), m;
    var base = new URL(ROOT).pathname;                       // "/" ou "/repositorio/"
    if (path.indexOf(base) === 0) path = "/" + path.slice(base.length);
    if ((m = path.match(/^\/(\d{4})\/(\d{2})\/([^/]+?)(?:\.html)?\/?$/))) {
      var id = m[1] + "/" + m[2] + "/" + m[3];
      return ROOT + (staticIds[id] ? "p/" + id.replace(/\//g, "-") + ".html" : "post.html?p=" + encodeURIComponent(id));
    }
    if ((m = path.match(/^\/p\/([^/]+?)(?:\.html)?\/?$/)) && pagesData[m[1]]) return ROOT + "pagina.html?p=" + encodeURIComponent(m[1]);
    if ((m = path.match(/^\/search\/label\/([^/]+)\/?$/))) return ROOT + "categoria.html?l=" + encodeURIComponent(m[1]);
    if (/^\/search\/?$/.test(path) && param("q")) return ROOT + "categoria.html?q=" + encodeURIComponent(param("q"));
    return "";
  }

  /* ------------------------------------------------------------------ inicialização */
  function loading() {
    var app = $("#app");
    if (app) app.innerHTML = '<div class="wrap" style="padding-top:7rem"><div class="skel" style="height:22rem;margin-bottom:1.5rem"></div><div class="skel" style="height:2rem;width:60%"></div></div>';
  }

  function init() {
    loading();
    fetchJSON("config.json").then(function (c) {
      cfg = c;
      window.IPA_PH = placeholder().replace(/"/g, "'");
      renderChrome(); bindScroll();
      return Promise.all([
        fetchJSON("data/posts.json").catch(function () { return { posts: [] }; }),
        fetchJSON("data/pages.json").catch(function () { return {}; })
      ]);
    }).then(function (r) {
      posts = (r[0].posts || []).slice();
      posts.forEach(function (p) { staticIds[p.id] = 1; });
      pagesData = r[1] || {};
      posts.sort(function (a, b) { return a.published < b.published ? 1 : -1; });

      if (PAGE === "post") {
        var id = window.__POST_ID || param("p");
        if (!id) return renderPostError("");
        id = id.replace(/\.html$/, "");
        var found = posts.filter(function (p) { return p.id === id; })[0];
        if (found) {
          renderPost(found);
          liveLatest(20).then(function (l) { if (mergePosts(l)) renderPost(posts.filter(function (p) { return p.id === id; })[0] || found); }).catch(function () {});
          return;
        }
        return liveOne(id).then(function (p) { mergePosts([p]); renderPost(p); }).catch(function () { renderPostError(id); });
      }
      if (PAGE === "page") return renderStaticPage();
      if (PAGE === "notfound") {
        var go = oldLinkTarget();
        if (go) { location.replace(go); return; }
        $("#app").innerHTML = pageTop("Erro 404", "Página não encontrada", "O endereço que você abriu não existe neste site.") + emptyBox("", "", '<a class="btn btn-red" href="index.html">Voltar para o início</a>');
        return setTitle("Página não encontrada");
      }

      var draw = PAGE === "home" ? renderHome : renderListing;
      draw();
      liveLatest(30).then(function (l) {
        var added = mergePosts(l);
        if (added) { var y = window.scrollY; draw(); window.scrollTo(0, y); }
      }).catch(function (err) {
        console.warn("[ipaporanga] feed ao vivo indisponível:", err && err.message);
      });
    }).catch(function (e) {
      console.error(e);
      var app = $("#app");
      if (app) app.innerHTML = '<div class="wrap empty"><h1>Algo deu errado</h1><p>' + esc(e.message) + "</p></div>";
    });
  }

  init();
})();

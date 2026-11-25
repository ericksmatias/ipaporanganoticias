/* Ipaporanga Notícias — front-end estático para o Blogger, com o layout do Intercept Brasil.
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
  function origHref(p) { return cfg.blogUrl + "/" + p.id + ".html"; }

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
    var url = cfg.blogUrl + "/feeds/posts/default?orderby=published&max-results=" + (n || 30);
    return jsonp(url).then(function (d) {
      liveOk = true;
      return ((d.feed && d.feed.entry) || []).map(entryToPost).filter(Boolean);
    });
  }
  function liveOne(id) {
    var url = cfg.blogUrl + "/feeds/posts/default?path=" + encodeURIComponent("/" + id + ".html");
    return jsonp(url).then(function (d) {
      var e = d.feed && d.feed.entry && d.feed.entry[0];
      var p = e && entryToPost(e);
      if (!p || p.id !== id) throw new Error("não encontrado");
      return p;
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
        if (n.getAttribute("href")) { n.setAttribute("rel", "noopener noreferrer"); if (!/^#/.test(h)) n.setAttribute("target", "_blank"); }
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
        p.className = "wp-block-paragraph";
        p.innerHTML = part;
        out.appendChild(p);
      });
    }
    function media(el) {
      $$("img", el).forEach(function (img) {
        var fig = document.createElement("figure");
        fig.className = "wp-block-image";
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
    return '<div class="ipa-ph"><span>' + esc(cfg.siteName.split(" ")[0]) + "<i>_</i></span></div>";
  }
  function figure(p, w, extra) {
    var im = p.image ? imgUrl(p.image, w) : "";
    var inner = im
      ? '<img src="' + esc(im) + '" alt="' + esc(p.title) + '" loading="lazy" decoding="async" onerror="this.outerHTML=IPA_PH">'
      : placeholder();
    return '<figure class="feed-figure hover-overlay overflow-hidden m-0">' + inner +
      '<p class="feed-title-sm" aria-label="hidden">Ler matéria</p></figure>';
  }
  window.IPA_PH = ""; // preenchido no init()

  function hook(p) {
    return '<div class="feed-hook"><span class="feed-date feed-author mb-0">' + esc(fmtShort(p.published)) + "</span>" +
      (p.author ? '<span class="feed-author mb-0">' + esc(p.author.replace(/\.$/, "")) + "</span>" : "") + "</div>";
  }
  function feedLg(p) {
    var c = catOf(p);
    return '<article class="feed feed-lg g-col-12"><a href="' + esc(postHref(p)) + '" class="feed-link text-decoration-none d-flex flex-column flex-md-row gap-2 gap-md-5 hover" title="' + esc(p.title) + '">' +
      figure(p, 640) +
      '<div class="feed-body d-flex flex-column justify-content-start mt-2 mt-md-0">' +
      '<p class="feed-hat mb-1">' + esc(c.name) + "</p>" +
      '<h3 class="feed-title feed-title-lg mb-2 mb-sm-3">' + esc(p.title) + "</h3>" + hook(p) + "</div>" +
      (p.excerpt ? '<p class="feed-excert feed-excert-lg m-0 line-clamp-6">' + esc(p.excerpt) + "</p>" : "") +
      "</a></article>";
  }
  function feedLead(p) {
    var c = catOf(p);
    return '<article class="feed ipa-lead"><a href="' + esc(postHref(p)) + '" class="feed-link hover" title="' + esc(p.title) + '">' +
      figure(p, 1200) + '<p class="feed-hat">' + esc(c.name) + "</p>" +
      '<h2 class="feed-title">' + esc(p.title) + "</h2>" + hook(p) +
      (p.excerpt ? '<p class="feed-excert">' + esc(p.excerpt) + "</p>" : "") + "</a></article>";
  }
  function feedSide(p) {
    var c = catOf(p);
    return '<article class="feed ipa-side"><a href="' + esc(postHref(p)) + '" class="feed-link hover" title="' + esc(p.title) + '">' +
      figure(p, 480) + '<div><p class="feed-hat">' + esc(c.name) + '</p><h3 class="feed-title">' + esc(p.title) + "</h3>" + hook(p) + "</div></a></article>";
  }
  function feedCard(p) {
    var c = catOf(p);
    return '<article class="feed ipa-card"><a href="' + esc(postHref(p)) + '" class="feed-link hover" title="' + esc(p.title) + '">' +
      figure(p, 640) + '<p class="feed-hat">' + esc(c.name) + '</p><h3 class="feed-title">' + esc(p.title) + "</h3>" + hook(p) + "</a></article>";
  }
  function sectionHead(title, href, more) {
    return '<div class="ipa-section-head"><h2 class="heading-title-lg bar-top text-uppercase mb-5">' + esc(title) + "</h2>" +
      (href ? '<a class="ipa-more-link" href="' + esc(href) + '">' + esc(more || "Ver tudo") + " &rarr;</a>" : "") + "</div>";
  }

  /* ------------------------------------------------------------------ cabeçalho / rodapé */
  function socialList(extraClass) {
    var s = cfg.social || {};
    var items = [];
    if (cfg.whatsapp) items.push(["WhatsApp", cfg.whatsapp, ICONS.whatsapp, "Fale com a redação pelo WhatsApp"]);
    if (s.instagram) items.push(["Instagram", s.instagram, ICONS.instagram]);
    if (s.facebook) items.push(["Facebook", s.facebook, ICONS.facebook]);
    return '<div class="social-media-links d-flex ' + (extraClass || "") + '"><ul class="d-flex justify-content-end gap-3 align-items-center list-unstyled m-0">' +
      items.map(function (i) {
        return '<li class="social-tooltip"><a target="_blank" rel="noreferrer" href="' + esc(i[1]) + '" class="d-flex" title="Acessar ' + i[0] + '">' + i[2] +
          (i[3] ? '<span class="tooltip">' + esc(i[3]) + "</span>" : "") + "</a></li>";
      }).join("") + "</ul></div>";
  }
  function logo(dark) {
    var w = cfg.siteName.split(" ");
    return '<a href="index.html" class="ipa-logo' + (dark ? " is-dark" : "") + '" rel="home" title="Página inicial"><span>' + esc(w[0]) + "<i>_</i></span><span>" + esc(w.slice(1).join(" ")) + "</span></a>";
  }
  function searchForm(val) {
    return '<section class="widget widget_block"><div class="widget-search" data-state="always-open"><div class="search-body">' +
      '<form action="categoria.html" method="GET" class="search-submit-btn" role="search">' +
      '<input type="text" name="q" class="input-search" aria-label="Campo de pesquisa" placeholder="Buscar" value="' + esc(val || "") + '">' +
      '<button type="submit" class="btn-search" title="Buscar"><i class="bi bi-search" aria-hidden="true"></i></button></form></div></div></section>';
  }
  function menuItems() {
    var items = [["Início", "index.html"]];
    cfg.categories.forEach(function (c) { items.push([c.name, catHref(c.slug)]); });
    items.push(["Sobre o autor", "pagina.html?p=sobre-o-autor"]);
    if (cfg.whatsapp) items.push(["Fale conosco", cfg.whatsapp, true]);
    items.push(["Site original", cfg.blogUrl + "/", true]);
    return items;
  }
  function renderChrome() {
    var h = $("#app-header");
    if (h) {
      h.innerHTML =
        '<header class="bg-dark position-sticky top-0 w-100" style="z-index:1050"><div class="container-fluid"><div class="row align-items-center">' +
        '<div class="col-auto logo-secao d-flex align-items-center gap-2">' +
        '<button class="btn btn-toggle-menu button-default-md d-flex align-items-center p-0" aria-label="Menu" type="button" aria-controls="offcanvasIpa" aria-expanded="false">' + ICONS.menu + "</button>" +
        '<div class="header-logo w-100">' + logo() + "</div></div>" +
        '<div class="col text-center"><div class="header-search-wrapper mx-auto">' + searchForm(param("q")) + "</div></div>" +
        '<div class="col-auto redes-secao text-end"><div class="header-widget-right d-none d-md-flex align-items-center justify-content-end gap-3">' + socialList() + "</div></div>" +
        "</div></div></header>" +
        '<div class="offcanvas offcanvas-start sidebar" tabindex="-1" id="offcanvasIpa" aria-label="Menu" aria-hidden="true">' +
        '<div class="offcanvas-header">' + logo() + '<button type="button" class="btn-close" aria-label="Fechar"></button></div>' +
        '<div class="offcanvas-header bottom d-flex flex-column gap-3"><div class="header-search-wrapper w-100">' + searchForm(param("q")) + "</div></div>" +
        '<div class="offcanvas-body"><div id="menu-cascade" class="menu-cascade"><ul>' +
        menuItems().map(function (i) {
          var cur = (location.pathname.split("/").pop() + location.search).indexOf(i[1]) > -1 && i[1] !== "index.html";
          return '<li><a href="' + esc(i[1]) + '"' + (i[2] ? ' target="_blank" rel="noopener"' : "") + (cur ? ' class="is-active"' : "") + ">" + esc(i[0]) + "</a></li>";
        }).join("") + "</ul></div></div>" +
        '<div class="offcanvas-footer">' + socialList() + "</div></div>" +
        '<div class="offcanvas-backdrop"></div>';
      var panel = $("#offcanvasIpa"), back = $(".offcanvas-backdrop"), btn = $(".btn-toggle-menu");
      var toggle = function (open) {
        panel.classList.toggle("show", open); back.classList.toggle("show", open);
        panel.setAttribute("aria-hidden", open ? "false" : "true"); btn.setAttribute("aria-expanded", open ? "true" : "false");
        document.body.classList.toggle("ipa-lock", open);
      };
      btn.addEventListener("click", function () { toggle(!panel.classList.contains("show")); });
      back.addEventListener("click", function () { toggle(false); });
      $(".btn-close", panel).addEventListener("click", function () { toggle(false); });
      document.addEventListener("keydown", function (e) { if (e.key === "Escape") toggle(false); });
    }
    var f = $("#app-footer");
    if (f) {
      f.innerHTML =
        '<footer class="footer pt-10 pb-6"><div class="container"><div class="grid gap-5 footer-top">' +
        '<div class="g-col-12 text-center g-col-md-2 footer-logo d-flex flex-column flex-md-row align-itens-center gap-2 px-4 px-md-0">' + logo() + "</div>" +
        '<div class="g-col-12 g-col-md-5 footer-widget-left d-flex flex-column flex-md-row gap-2 px-4 px-md-0">' +
        (cfg.whatsapp ? '<a target="_blank" rel="noopener" href="' + esc(cfg.whatsapp) + '" class="py-3 pe-3 pe-md-9 d-block d-md-inline-block btn btn-primary text-start text-uppercase" title="Fale com a redação">Fale com a redação <i class="bi bi-chevron-right"></i></a>' : "") + "</div>" +
        '<div class="g-col-12 g-col-md-5 footer-widget-right d-flex flex-column flex-md-row gap-2 px-4 px-md-0">' + socialList() + "</div>" +
        '<nav class="g-col-12 footer-navigation mt-3 mt-md-6 px-4 px-md-0"><div class="menu-links"><ul>' +
        cfg.categories.map(function (c) { return '<li><a title="' + esc(c.name) + '" href="' + esc(catHref(c.slug)) + '" class="no-child">' + esc(c.name) + "</a></li>"; }).join("") +
        '<li><a href="' + esc(cfg.blogUrl) + '/" target="_blank" rel="noopener" class="no-child">Site original</a></li></ul></div></nav></div>' +
        '<hr class="mt-4 mt-md-6 mb-4"><div class="footer-bottom d-flex flex-column flex-md-row justify-content-md-between align-items-center align-items-md-end px-4 px-md-0">' +
        '<div class="footer-copyright d-flex gap-5 flex-column flex-md-row justify-content-md-between align-items-center align-items-md-end">' +
        '<p class="footer-subsection text-center text-md-start m-0">©' + new Date().getFullYear() + " " + esc(cfg.siteName) + ". Todos os direitos reservados</p>" +
        '<div class="menu-obrigatorio-container"><ul>' +
        '<li><a href="pagina.html?p=sobre-o-autor">Sobre o autor</a></li>' +
        '<li><a href="pagina.html?p=privacidade-sua-privacidade-e">Política de privacidade</a></li>' +
        '<li><a href="pagina.html?p=termos-de-uso">Termos de uso</a></li></ul></div></div></div></div></footer>' +
        '<div class="ipa-status" id="ipaStatus" role="status"></div>';
    }
  }
  function status(msg, ms) {
    var s = $("#ipaStatus"); if (!s) return;
    s.textContent = msg; s.classList.add("show");
    clearTimeout(status.t); status.t = setTimeout(function () { s.classList.remove("show"); }, ms || 3500);
  }

  /* ------------------------------------------------------------------ páginas */
  function setTitle(t) { document.title = t ? t + " | " + cfg.siteName : cfg.siteName + " — " + cfg.tagline; }

  function renderHome() {
    var app = $("#app");
    var list = posts;
    if (!list.length) { app.innerHTML = '<div class="container-xl ipa-empty"><h1>Sem matérias por aqui</h1><p>Não consegui carregar as notícias agora.</p><a class="btn btn-primary" href="' + esc(cfg.blogUrl) + '/">Abrir o site original</a></div>'; return; }
    var feats = list.slice(0, 2), rest = list.slice(2);
    function featMd(p) {
      var c = catOf(p);
      return '<article class="feed feed-md g-col-12 g-col-md-6 v2"><a href="' + esc(postHref(p)) + '" class="feed-link d-flex flex-column gap-3 gap-sm-4 text-decoration-none hover" title="' + esc(p.title) + '">' +
        figure(p, 880) + '<div class="feed-body flex-1 d-flex flex-column justify-content-center"><p class="feed-hat mb-1">' + esc(c.name) + '</p>' +
        '<h2 class="feed-title feed-title-md mb-2">' + esc(p.title) + "</h2>" + hook(p) + "</div></a></article>";
    }
    var h = '<main class="archive overflow-x-clip"><section class="section-hero-featured"><section class="grid-section-hero-featured bg-gray-900 is-dark"><div class="container-lg px-4 px-lg-0"><div class="grid gap-4">' +
      '<div class="g-col-12 g-col-lg-12 g-start-xl-3 g-start-xxl-3 g-col-xl-10 g-col-xxl-8 grid px-0 px-lg-5 ps-xl-5 pe-xl-0">' + feats.map(featMd).join("") +
      (cfg.whatsapp ? '<div class="g-col-12 mt-4"><a target="_blank" rel="noopener" href="' + esc(cfg.whatsapp) + '" class="btn btn-primary d-block text-start btn-lg py-3 text-uppercase" title="Fale com a redação">Fale com a redação <i class="bi bi-chevron-right"></i></a></div>' : "") +
      '</div></div></div></section></section>' +
      '<section class="section-feeds-lg"><div class="container-lg px-4 px-lg-0"><div class="grid gap-4 mb-9"><div class="archive-aside g-col-lg-1 g-col-xl-2 g-col-xxl-2 d-none d-lg-block"></div>' +
      '<div class="g-col-12 g-col-lg-12 g-col-xl-10 g-col-xxl-8 grid gap-0 negative-body" style="--offwidth:62px"><div class="archive-list-feed g-col-12 py-4 py-md-5"><div class="grid gap-row-4" id="ipaList"></div></div>' +
      '<div class="g-col-12 d-flex justify-content-center mt-4 ipa-loadmore" style="margin-top:0"><button type="button" class="btn btn-outline-black d-block btn-lg text-uppercase" id="ipaMore">Carregar mais matérias <i class="bi bi-chevron-right"></i></button></div>' +
      "</div></div></div></section></main>";
    app.innerHTML = h;
    var shown = 0, size = cfg.pageSize || 12, box = $("#ipaList"), more = $("#ipaMore");
    function add() {
      var chunk = rest.slice(shown, shown + size);
      box.insertAdjacentHTML("beforeend", chunk.map(feedLg).join(""));
      shown += chunk.length;
      if (shown >= rest.length) more.parentNode.style.display = "none";
    }
    add();
    more.addEventListener("click", add);
    setTitle("");
  }

  function renderListing() {
    var app = $("#app");
    var slug = param("c"), q = (param("q") || "").trim(), label = param("l");
    var c = slug && catBySlug(slug);
    var items, title, sub;
    if (q) {
      var terms = fold(q);
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
    } else {
      items = posts; title = "Todas as matérias"; sub = items.length + " matérias carregadas";
    }
    var origin = q ? cfg.blogUrl + "/search?q=" + encodeURIComponent(q) : (c ? cfg.blogUrl + "/search/label/" + encodeURIComponent(c.name) : cfg.blogUrl + "/");
    var h = '<div class="container-xl ipa-main" style="padding-left:1.5rem;padding-right:1.5rem"><h1 class="ipa-page-title">' + esc(title) + '</h1><p class="ipa-page-sub">' + esc(sub) + "</p>";
    if (!items.length) {
      h += '<div class="ipa-empty"><h1>Nada encontrado</h1><p>Tente outra palavra ou procure no site original.</p><a class="btn btn-primary" target="_blank" rel="noopener" href="' + esc(origin) + '">Buscar no site original</a></div></div>';
      app.innerHTML = h; setTitle(title); return;
    }
    h += '<div class="ipa-list grid" id="ipaList"></div><div class="ipa-loadmore"><button type="button" class="btn btn-outline-primary" id="ipaMore">Carregar mais</button></div>' +
      '<p class="ipa-page-sub" style="text-align:center;margin-top:2rem">Matérias mais antigas: <a class="text-primary" target="_blank" rel="noopener" href="' + esc(origin) + '">ver no site original</a></p></div>';
    app.innerHTML = h;
    var shown = 0, size = cfg.pageSize || 12, box = $("#ipaList"), more = $("#ipaMore");
    function add() {
      var chunk = items.slice(shown, shown + size);
      box.insertAdjacentHTML("beforeend", chunk.map(feedLg).join(""));
      shown += chunk.length;
      if (shown >= items.length) more.parentNode.style.display = "none";
    }
    add(); more.addEventListener("click", add);
    setTitle(title);
  }

  function shareLinks(p) {
    var base = cfg.siteUrl ? cfg.siteUrl.replace(/\/$/, "") + "/p/" + p.id.replace(/\//g, "-") + ".html" : location.href.split("#")[0];
    var u = encodeURIComponent(base), t = encodeURIComponent(p.title);
    var xIcon = ICONS.x || "";
    return '<div class="social-share"><ul class="d-flex justify-content-end gap-0 align-items-center list-unstyled m-0">' +
      '<li><a target="_blank" rel="noreferrer" href="https://api.whatsapp.com/send?text=' + t + "%20-%20" + u + '" class="d-flex align-items-center justify-content-center" title="Compartilhe via WhatsApp.">' + ICONS.shareWhatsapp + "</a></li>" +
      '<li><a target="_blank" rel="noreferrer" href="https://www.facebook.com/sharer/sharer.php?u=' + u + '" class="d-flex align-items-center justify-content-center" title="Compartilhe via Facebook.">' + ICONS.shareFacebook + "</a></li>" +
      '<li><a target="_blank" rel="noreferrer" href="https://twitter.com/intent/tweet?text=' + t + "&url=" + u + '" class="d-flex align-items-center justify-content-center" title="Compartilhe via X.">' + xIcon + "</a></li>" +
      '<li><a target="_blank" rel="noopener" href="' + esc(origHref(p)) + '" class="d-flex" title="Ver no site original"><p class="button-default-md m-0">SITE ORIGINAL</p></a></li></ul></div>';
  }

  function renderPost(p) {
    var app = $("#app");
    var c = catOf(p);
    var body = buildBody(p.html || "");
    // a primeira imagem do corpo vira o destaque (hero), como no Intercept
    var hero = p.image || "";
    var first = body.firstElementChild;
    if (first && first.tagName === "FIGURE" && first.querySelector("img")) {
      var src = first.querySelector("img").getAttribute("src");
      if (!hero || sameImage(src, hero)) { hero = src; first.remove(); }
    }
    var heroImg = hero ? imgUrl(hero, 1600) : "";
    var related = posts.filter(function (x) { return x.id !== p.id && catOf(x).slug === c.slug; }).slice(0, 5);
    if (related.length < 5) related = related.concat(posts.filter(function (x) { return x.id !== p.id && related.indexOf(x) < 0; }).slice(0, 5 - related.length));

    var labels = [];
    (p.labels || []).forEach(function (l) { var k = fold(l); if (k && labels.every(function (x) { return fold(x) !== k; })) labels.push(l); });

    var h = '<main id="post" class="single pb-12 standard_post' + (heroImg ? "" : " no-hero") + '">';
    if (heroImg) h += '<section class="single-hero-standard" id="ipaHero"><img class="img-fluid" id="ipaHeroImg" alt="' + esc(p.title) + '" src="' + esc(heroImg) + '" fetchpriority="high" decoding="async"></section>';
    h += '<div class="container-xl"><div class="grid gap-4"><div class="single-aside g-col-lg-1 g-col-xl-2 g-col-xxl-2 d-none d-md-block">' + shareLinks(p) + "</div>" +
      '<div class="g-col-12 g-col-lg-9 g-col-xl-8 grid gap-0 negative-body" style="--offwidth:264px">' +
      '<section class="single-header g-col-12 pt-4 py-md-5 m-negative m-md-0 px-4 px-lg-0"><div class="grid gap-0"><div class="g-col-12 grid gap-x-0 gap-y-4">' +
      '<div class="single-head grid g-col-12"><strong class="g-col-12"><p class="feed-hat mb-2"><a href="' + esc(catHref(c.slug)) + '" style="text-decoration:none">' + esc(c.name) + '</a></p><h1 class="content-title text-gray-900 m-0">' + esc(p.title) + "</h1></strong></div>" +
      '<div class="single-head-bottom g-col-12 pt-4 d-flex flex-column flex-lg-row align-content-center"><div class="g-col-12 g-col-lg-4 single-head-bottom-left d-flex flex-1 align-items-center justify-content-start">' +
      '<div class="single-authors d-flex flex-wrap gap-3 w-100"><div class="single-authors-body d-flex flex-1 flex-column justify-content-center">' +
      (p.author ? '<p class="content-author text-primary m-0">' + esc(p.author.replace(/\.$/, "")) + "</p>" : "") +
      '<time class="text-gray-500 content-infopost mb-0 mt-2" datetime="' + esc(p.published) + '">' + esc(fmtLong(p.published)) + "</time></div></div></div>" +
      '<div class="g-col-12 g-col-lg-4 single-head-bottom-right d-flex flex-1 align-items-center justify-content-start justify-content-md-end"><div class="d-block d-md-none" style="width:100%">' + shareLinks(p) + "</div></div></div>" +
      "</div></div></section><hr class=\"g-col-12 m-0\">" +
      '<section class="single-body g-col-12"><div class="grid gap-0"><article class="g-col-12 g-col-md-10 pt-6 m-negative m-md-0"><div class="single-content px-4 px-lg-0" id="ipaBody"></div></article></div></section>' +
      '<div class="tax-links tax-mix-links px-4 px-lg-0"><div class="d-flex mb-3"><span class="button-default-lg text-primary m-0">TEMAS RELACIONADOS</span></div>' +
      '<ul class="m-0 d-flex flex-wrap align-items-center justify-content-start gap-2 gap-md-3 list-unstyled"><li class="m-0 d-flex"><a class="btn btn-outline-primary btn-sm" href="' + esc(catHref(c.slug)) + '">' + esc(c.name) + "</a></li>" +
      labels.filter(function (l) { return !c.match.some(function (m) { return fold(l) === m; }); }).map(function (l) { return '<li class="m-0 d-flex"><a class="btn btn-outline-primary btn-sm" href="categoria.html?l=' + encodeURIComponent(l) + '">' + esc(l.replace(/\.$/, "")) + "</a></li>"; }).join("") + "</ul></div>" +
      '<section class="related-posts g-col-12 mt-9 mt-md-10 m-negative mx-lg-0 px-4 px-lg-0"><p class="heading-title-lg bar-top text-uppercase mb-5">Artigos recentes</p><div class="g-col-12 row"><div class="grid gap-row-6">' + related.map(feedLg).join("") + "</div></div></section>" +
      (cfg.whatsapp ? '<section class="ipa-cta g-col-12"><span class="content-title text-black" style="display:block;font-size:1.1rem!important">redação</span><span class="content-title text-primary">Tem uma pauta ou denúncia?</span><p>Envie fotos, vídeos e informações direto para a redação do ' + esc(cfg.siteName) + '.</p><a class="btn btn-primary" target="_blank" rel="noopener" href="' + esc(cfg.whatsapp) + '">Falar no WhatsApp</a></section>' : "") +
      "</div></div></div></main>";
    app.innerHTML = h;
    $("#ipaBody").appendChild(body);
    if (!body.children.length) $("#ipaBody").innerHTML = '<p class="wp-block-paragraph">Esta matéria não tem texto. <a href="' + esc(origHref(p)) + '" target="_blank" rel="noopener">Abrir no site original</a>.</p>';

    var im = $("#ipaHeroImg");
    if (im) {
      var fit = function () {
        if (im.naturalWidth && im.naturalWidth < 1100) { var s = $("#ipaHero"); s.classList.add("is-contain"); s.style.backgroundImage = 'url("' + im.currentSrc.replace(/"/g, "") + '")'; }
      };
      if (im.complete) fit(); else im.addEventListener("load", fit);
      im.addEventListener("error", function () { var s = $("#ipaHero"); if (s) s.remove(); });
    }
    document.title = p.title + " | " + cfg.siteName;
  }

  function renderPostError(id) {
    $("#app").innerHTML = '<div class="container-xl ipa-error"><h1>Matéria não encontrada</h1><p>Ela pode ser antiga demais para estar neste site de testes.</p>' +
      '<a class="btn btn-primary" target="_blank" rel="noopener" href="' + esc(cfg.blogUrl + "/" + id + ".html") + '">Ler no site original</a></div>';
    setTitle("Matéria não encontrada");
  }

  function renderStaticPage() {
    var id = param("p") || "";
    var pg = pagesData[id];
    var app = $("#app");
    if (!pg) {
      app.innerHTML = '<div class="container-xl ipa-error"><h1>Página não encontrada</h1><p>Essa página não existe aqui.</p><a class="btn btn-primary" href="index.html">Voltar para o início</a></div>';
      setTitle("Página não encontrada"); return;
    }
    app.innerHTML = '<main class="single pb-12 no-hero"><div class="container-xl"><div class="grid gap-4"><div class="g-col-12 g-col-lg-9 g-col-xl-8 g-start-xl-3 px-4 px-lg-0">' +
      '<h1 class="content-title text-gray-900 m-0" style="text-transform:uppercase">' + esc(pg.title) + '</h1><div class="single-content pt-6" id="ipaBody"></div></div></div></div></main>';
    $("#ipaBody").appendChild(buildBody(pg.html));
    setTitle(pg.title);
  }

  /* ------------------------------------------------------------------ inicialização */
  function loading() {
    var app = $("#app");
    if (app) app.innerHTML = '<div class="container-xl ipa-main" style="padding-left:1.5rem;padding-right:1.5rem"><div class="ipa-skel" style="height:22rem;margin-bottom:2rem"></div><div class="ipa-skel" style="height:2rem;width:60%"></div></div>';
  }

  function init() {
    loading();
    fetchJSON("config.json").then(function (c) {
      cfg = c;
      window.IPA_PH = placeholder().replace(/"/g, "&quot;").replace(/&quot;/g, "'");
      renderChrome();
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
          // enriquece "artigos recentes" com o que há de novo no blog
          liveLatest(20).then(function (l) { if (mergePosts(l)) renderPost(posts.filter(function (p) { return p.id === id; })[0] || found); }).catch(function () {});
          return;
        }
        return liveOne(id).then(function (p) { mergePosts([p]); renderPost(p); }).catch(function () { renderPostError(id); });
      }
      if (PAGE === "page") return renderStaticPage();
      if (PAGE === "notfound") {
        $("#app").innerHTML = '<div class="container-xl ipa-error"><h1>Página não encontrada</h1><p>O endereço que você abriu não existe neste site.</p><a class="btn btn-primary" href="index.html">Voltar para o início</a></div>';
        return setTitle("Página não encontrada");
      }

      var draw = PAGE === "home" ? renderHome : renderListing;
      draw();
      liveLatest(30).then(function (l) {
        var added = mergePosts(l);
        if (added) { draw(); status(added + (added > 1 ? " matérias novas" : " matéria nova") + " do site original"); }
      }).catch(function () { /* sem feed ao vivo: segue com data/posts.json */ });
    }).catch(function (e) {
      console.error(e);
      var app = $("#app");
      if (app) app.innerHTML = '<div class="container-xl ipa-error"><h1>Algo deu errado</h1><p>' + esc(e.message) + "</p></div>";
    });
  }

  init();
})();

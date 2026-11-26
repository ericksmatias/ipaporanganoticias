"""Funções compartilhadas pelos scripts de geração de dados."""
import html, json, os, re, unicodedata
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SITE = os.path.join(ROOT, "docs")


def load_config():
    with open(os.path.join(SITE, "config.json"), encoding="utf8") as f:
        cfg = json.load(f)
    # no GitHub Actions o endereço do site é injetado automaticamente
    if os.environ.get("SITE_URL"):
        cfg["siteUrl"] = os.environ["SITE_URL"].rstrip("/")
    if os.environ.get("FEED_BASE"):  # útil para testes
        cfg["feedBase"] = os.environ["FEED_BASE"].rstrip("/")
    return cfg


def post_id_from_url(url):
    """https://dominio/2026/11/slug.html -> 2026/11/slug"""
    m = re.match(r"https?://[^/]+/(\d{4}/\d{2}/[^?#]+?)(?:\.html)?(?:[?#].*)?$", url.strip())
    return m.group(1) if m else None


def page_id_from_url(url):
    m = re.match(r"https?://[^/]+/p/([^?#]+?)(?:\.html)?(?:[?#].*)?$", url.strip())
    return m.group(1) if m else None


def strip_tags(s):
    s = re.sub(r"(?is)<(script|style)[^>]*>.*?</\1>", " ", s)
    s = re.sub(r"(?i)<br\s*/?>|</?(?:p|div|li|h[1-6]|tr)[^>]*>", " ", s)
    s = re.sub(r"<[^>]+>", "", s)
    s = html.unescape(s).replace("\xa0", " ")
    return re.sub(r"\s+", " ", s).strip()


def make_excerpt(body, n=220):
    t = strip_tags(body)
    if len(t) <= n:
        return t
    cut = t[:n].rsplit(" ", 1)[0]
    return cut.rstrip(" ,;:-") + "…"


def first_image(body):
    m = re.search(r"""<img[^>]+src=["']([^"']+)["']""", body, re.I)
    return m.group(1) if m else ""


def shell_name(pid):
    return pid.replace("/", "-") + ".html"


def e(s):
    return html.escape(s or "", quote=True)


def write_json(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))


def shell_head(cfg, post):
    base = cfg.get("siteUrl", "").rstrip("/")
    title = f'{post["title"]} | {cfg["siteName"]}'
    url = f'{base}/p/{shell_name(post["id"])}' if base else ""
    img = post.get("image", "")
    img = re.sub(r"/(?:s\d+|w\d+(?:-h\d+)?(?:-[a-z]+)*)/([^/]+)$", r"/w1200-h630-p-k-no-nu/\1", img)
    desc = post.get("excerpt", "")
    parts = [
        '<base href="../">',
        f'<script>window.__POST_ID={json.dumps(post["id"])};</script>',
        f"<title>{e(title)}</title>",
        f'<meta name="description" content="{e(desc)}">',
        f'<meta property="og:type" content="article">',
        f'<meta property="og:site_name" content="{e(cfg["siteName"])}">',
        f'<meta property="og:title" content="{e(post["title"])}">',
        f'<meta property="og:description" content="{e(desc)}">',
        f'<meta property="article:published_time" content="{e(post["published"])}">',
        '<meta name="twitter:card" content="summary_large_image">',
    ]
    if img:
        parts.append(f'<meta property="og:image" content="{e(img)}">')
        parts.append(f'<meta name="twitter:image" content="{e(img)}">')
    if url:
        parts.append(f'<meta property="og:url" content="{e(url)}">')
        parts.append(f'<link rel="canonical" href="{e(url)}">')
    return "\n".join(parts)


def write_outputs(posts, pages, cfg):
    """Escreve data/posts.json, data/pages.json, p/*.html (para compartilhamento) e sitemap.xml."""
    posts = sorted(posts, key=lambda p: p["published"], reverse=True)
    write_json(os.path.join(SITE, "data", "posts.json"), {
        "generated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "posts": posts,
    })
    write_json(os.path.join(SITE, "data", "pages.json"), pages)

    tpl_path = os.path.join(SITE, "post.html")
    with open(tpl_path, encoding="utf8") as f:
        tpl = f.read()
    pat = re.compile(r"<!--SEO-->.*?<!--/SEO-->", re.S)
    if not pat.search(tpl):
        raise SystemExit("post.html precisa conter <!--SEO-->...<!--/SEO-->")
    pdir = os.path.join(SITE, "p")
    os.makedirs(pdir, exist_ok=True)
    for old in os.listdir(pdir):
        if old.endswith(".html"):
            os.remove(os.path.join(pdir, old))
    for p in posts:
        out = pat.sub(lambda m: shell_head(cfg, p), tpl, count=1)
        with open(os.path.join(pdir, shell_name(p["id"])), "w", encoding="utf8") as f:
            f.write(out)

    base = cfg.get("siteUrl", "").rstrip("/")
    if base:
        urls = [f"{base}/"] + [f'{base}/categoria.html?c={c["slug"]}' for c in cfg["categories"]]
        urls += [f'{base}/p/{shell_name(p["id"])}' for p in posts]
        sm = ['<?xml version="1.0" encoding="UTF-8"?>',
              '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">']
        for u in urls:
            sm.append(f"<url><loc>{e(u)}</loc></url>")
        sm.append("</urlset>")
        with open(os.path.join(SITE, "sitemap.xml"), "w", encoding="utf8") as f:
            f.write("\n".join(sm))
        with open(os.path.join(SITE, "robots.txt"), "w", encoding="utf8") as f:
            f.write(f"User-agent: *\nAllow: /\nSitemap: {base}/sitemap.xml\n")
    print(f"{len(posts)} posts, {len(pages)} páginas, {len(posts)} páginas de compartilhamento")

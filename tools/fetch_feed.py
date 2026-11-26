#!/usr/bin/env python3
"""Atualiza data/posts.json a partir do feed JSON do Blogger (usado pelo GitHub Action).

Mantém os posts já existentes e acrescenta/atualiza os mais novos, limitando ao
valor de "maxPostsInJson" em docs/config.json.
"""
import json, os, sys, time, urllib.request
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import *

UA = {"User-Agent": "Mozilla/5.0 (compatible; IpaporangaFrontendBot/1.0)"}


def get(url, tries=4):
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=40) as r:
                return json.load(r)
        except Exception as ex:
            print(f"  tentativa {i+1} falhou: {ex}", file=sys.stderr)
            time.sleep(2 * (i + 1))
    raise SystemExit(f"Não consegui baixar {url}")


def alt_link(entry):
    for l in entry.get("link", []):
        if l.get("rel") == "alternate":
            return l["href"]
    return ""


def entry_to_post(en):
    url = alt_link(en)
    pid = post_id_from_url(url)
    if not pid:
        return None
    body = (en.get("content") or en.get("summary") or {}).get("$t", "")
    img = first_image(body)
    if not img and "media$thumbnail" in en:
        img = en["media$thumbnail"]["url"]
    return {
        "id": pid,
        "title": en["title"]["$t"].strip(),
        "published": en["published"]["$t"],
        "updated": en["updated"]["$t"],
        "author": (en.get("author") or [{}])[0].get("name", {}).get("$t", ""),
        "labels": [c["term"] for c in en.get("category", [])],
        "image": img,
        "excerpt": make_excerpt(body),
        "html": body,
    }


def main():
    cfg = load_config()
    feed_base = cfg["feedBase"].rstrip("/")  # feed direto do Blogger (blogger.com/feeds/<id>)
    limit = int(cfg.get("maxPostsInJson", 600))
    path = os.path.join(SITE, "data", "posts.json")
    existing = {}
    if os.path.exists(path):
        for p in json.load(open(path, encoding="utf8")).get("posts", []):
            existing[p["id"]] = p

    fetched, start, step = [], 1, 100
    while len(fetched) < limit:
        url = f"{feed_base}/posts/default?alt=json&orderby=published&max-results={step}&start-index={start}"
        print("GET", url)
        feed = get(url)["feed"]
        entries = feed.get("entry", [])
        if not entries:
            break
        for en in entries:
            p = entry_to_post(en)
            if p:
                fetched.append(p)
        start += step
        if len(entries) < step:
            break
    if not fetched:
        raise SystemExit("Feed vazio: mantendo dados anteriores.")
    for p in fetched:
        existing[p["id"]] = p
    posts = sorted(existing.values(), key=lambda p: p["published"], reverse=True)[:limit]

    pages = {}
    ppath = os.path.join(SITE, "data", "pages.json")
    if os.path.exists(ppath):
        pages = json.load(open(ppath, encoding="utf8"))
    try:
        pf = get(f"{feed_base}/pages/default?alt=json&max-results=50")["feed"].get("entry", [])
        for en in pf:
            pid = page_id_from_url(alt_link(en))
            if pid:
                pages[pid] = {"title": en["title"]["$t"], "html": en["content"]["$t"]}
    except SystemExit:
        print("Páginas estáticas não atualizadas.", file=sys.stderr)

    write_outputs(posts, pages, cfg)


if __name__ == "__main__":
    main()

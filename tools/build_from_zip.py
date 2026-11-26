#!/usr/bin/env python3
"""Gera data/posts.json a partir de uma cópia local do blog (wget/HTTrack).

Uso: python3 tools/build_from_zip.py <pasta www.ipaporanganoticias.com.br>
"""
import glob, html, os, re, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import *

BODY = re.compile(r"<div class='post-body[^']*'>(.*?)</div>\s*(?:<div class='post-footer'>|</div>\s*<div class='blog-post-comments'>)", re.S)


def parse(path, is_page=False):
    s = open(path, encoding="utf8", errors="replace").read()
    mc = re.search(r"<link href='([^']+)' rel='canonical'", s)
    if not mc:
        return None
    url = mc.group(1)
    pid = page_id_from_url(url) if is_page else post_id_from_url(url)
    if not pid:
        return None
    mt = re.search(r"<h[13] class='post-title[^']*'>\s*(.*?)\s*</h[13]>", s, re.S)
    mb = BODY.search(s)
    if not mt or not mb:
        return None
    title = html.unescape(re.sub(r"<[^>]+>", "", mt.group(1))).strip()
    body = mb.group(1).strip()
    if is_page:
        return {"id": pid, "title": title, "html": body}
    md = re.search(r"class='post-date published' datetime='([^']+)'", s)
    mu = re.search(r'"dateModified": "([^"]+)"', s)
    ma = re.search(r"class='post-author'><a[^>]*title='([^']*)'", s)
    labels = [html.unescape(x).strip() for x in re.findall(r"class='label-link'[^>]*>([^<]+)</a>", s)]
    if not md:
        return None
    img = first_image(body)
    if not img:
        mo = re.search(r"<meta content='([^']+)' property='og:image'", s)
        img = mo.group(1) if mo else ""
    return {
        "id": pid,
        "title": title,
        "published": md.group(1),
        "updated": mu.group(1) if mu else md.group(1),
        "author": html.unescape(ma.group(1)).strip() if ma else "",
        "labels": labels,
        "image": img,
        "excerpt": make_excerpt(body),
        "html": body,
    }


def main(root):
    cfg = load_config()
    posts, seen = [], set()
    for f in glob.glob(os.path.join(root, "20??", "*", "*.html")):
        p = parse(f)
        if p and p["id"] not in seen:
            seen.add(p["id"])
            posts.append(p)
    pages = {}
    for f in glob.glob(os.path.join(root, "p", "*.html")):
        p = parse(f, True)
        if p:
            pages[p["id"]] = {"title": p["title"], "html": p["html"]}
    write_outputs(posts, pages, cfg)


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])

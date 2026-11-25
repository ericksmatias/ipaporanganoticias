import re,sys,base64,hashlib,os,glob
src=sys.argv[1]; out=sys.argv[2]
s=open(src,encoding='utf8',errors='replace').read()
styles=re.findall(r'<style[^>]*>(.*?)</style>',s,re.S)
ext={'font/woff2':'woff2','font/woff':'woff','application/font-woff2':'woff2','application/x-font-ttf':'ttf','font/ttf':'ttf','image/webp':'webp','image/png':'png','image/jpeg':'jpg','image/svg+xml':'svg','image/gif':'gif','application/vnd.ms-fontobject':'eot','application/octet-stream':'bin','image/avif':'avif'}
seen={}
def repl(m):
    mime=m.group(1); data=m.group(2)
    try: b=base64.b64decode(data)
    except Exception: return m.group(0)
    e=ext.get(mime,'bin')
    h=hashlib.md5(b).hexdigest()[:10]
    sub='fonts' if e in('woff2','woff','ttf','eot') else 'img'
    p=f'{out}/assets/{sub}/{h}.{e}'
    if not os.path.exists(p): open(p,'wb').write(b)
    return f'../{sub}/{h}.{e}'
def clean(css):
    css=re.sub(r'data:([a-z0-9/+.\-]+);base64,([A-Za-z0-9+/=]+)',repl,css)
    return css
parts=[]
for i,c in enumerate(styles):
    c2=clean(c)
    if len(c2.strip())>0: parts.append((i,c2))
for i,c in parts: print(i,len(c),c[:70].replace('\n',' '))
import json
json.dump(parts,open('/tmp/claude-0/-home-claude/f8afdfba-a167-5cb0-8180-e0c492012ecb/scratchpad/an/parts.json','w'))

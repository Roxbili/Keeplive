"""Read-only deployment checks; does not need album credentials."""
import argparse
import json
import re
import urllib.error
import urllib.request

parser=argparse.ArgumentParser()
parser.add_argument('--url',default='https://photos.cxzzzz.top')
args=parser.parse_args()
base=args.url.rstrip('/')

def get(path):
    try:
        response=urllib.request.urlopen(base+path,timeout=15)
    except urllib.error.HTTPError as error:
        response=error
    with response:
        return response.status,dict(response.headers.items()),response.read()

status,headers,index=get('/')
assert status==200 and b'Keeplive' in index,(status,index[:100])
assets=re.findall(r'(?:src|href)="(/assets/[^\"]+)"',index.decode())
assert assets,'Built assets not found in index.html'
for asset in assets:
    code,_,body=get(asset)
    assert code==200 and len(body)>100,(asset,code)
code,api_headers,body=get('/api/auth/status')
album=json.loads(body)
assert code==200 and album.get('authenticated') is False,(code,album)
assert album.get('setupAllowed') is False,'Gateway must not look like a local request'
code,_,_=get('/api/photos')
assert code==401,'Private album must still require login'
code,share_headers,share_body=get('/s/deployment-route-probe')
assert code==200 and share_body==index,'Share SPA route did not load the frontend'
assert 'no-store' in share_headers.get('Cache-Control','')
assert 'noindex' in share_headers.get('X-Robots-Tag','')
assert 'no-store' in api_headers.get('Cache-Control','')
def login_probe(origin):
    request=urllib.request.Request(base+'/api/auth/login',data=json.dumps({'username':'__deployment_probe_no_account__','password':'invalid-probe-password'}).encode(),headers={'Content-Type':'application/json','Origin':origin},method='POST')
    try:
        with urllib.request.urlopen(request,timeout=15) as response: return response.status
    except urllib.error.HTTPError as error:
        with error: return error.code
assert login_probe(base)==401,'Valid-origin login must reach password verification'
assert login_probe('https://deployment-invalid.example')==403,'Cross-origin login must be rejected'
print(json.dumps({'frontend':status,'assets':len(assets),'album':album,'private_photos':401,'share_route':200,'no_store':True,'login_origin':True},ensure_ascii=False))

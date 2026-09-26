"""Standard-library durable job client. No automatic paid retry.

MIO_API_TOKEN=... python examples/jobs_client.py --base http://127.0.0.1:8777 --key my-job-001 --prompt "A quiet lake"
Uses the server's OPENAI_API_KEY. Reuse --key only for the identical snapshot.
"""
import argparse
import base64
import json
import mimetypes
import os
import urllib.error
import urllib.request
from pathlib import Path

def request(base,token,path,body=None):
    data=None if body is None else json.dumps(body).encode()
    req=urllib.request.Request(base.rstrip('/')+'/api/v1/'+path,data=data,headers={'Authorization':'Bearer '+token,'Content-Type':'application/json'})
    try:
        with urllib.request.urlopen(req,timeout=60) as response:return json.load(response)['data']
    except urllib.error.HTTPError as exc:
        raise RuntimeError('HTTP '+str(exc.code)+': '+exc.read().decode('utf-8',errors='replace')) from None

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--base',default='http://127.0.0.1:8777');parser.add_argument('--key');parser.add_argument('--prompt');parser.add_argument('--model',default='gpt-image-1');parser.add_argument('--image',action='append',default=[]);parser.add_argument('--status');args=parser.parse_args()
    token=os.environ.get('MIO_API_TOKEN','')
    if len(token)<32:parser.error('Set MIO_API_TOKEN to a valid local API token')
    if args.status:print(json.dumps(request(args.base,token,'jobs/'+args.status),ensure_ascii=False,indent=2));return
    if not args.key or not args.prompt:parser.error('--key and --prompt are required when submitting')
    images=[]
    for filename in args.image:
        path=Path(filename);mime=mimetypes.guess_type(path.name)[0]
        if mime not in ('image/png','image/jpeg','image/webp'):parser.error('Images must be PNG/JPEG/WebP')
        data_url='data:'+mime+';base64,'+base64.b64encode(path.read_bytes()).decode()
        images.append(request(args.base,token,'assets/upload',{'name':path.name,'dataUrl':data_url})['url'])
    body={'idempotencyKey':args.key,'input':{'label':args.key,'frames':[{'config':{'provider':'openai','baseUrl':'https://api.openai.com/v1','protocol':'images','model':args.model,'keyMode':'environment','sendSize':False,'sendQuality':False},'prompt':args.prompt,'images':images}]}}
    job=request(args.base,token,'jobs',body)
    print(json.dumps(job,ensure_ascii=False,indent=2));print('Query again with --status '+job['id']+'; do not submit a new key merely because an acknowledgement is late.')
if __name__=='__main__':main()

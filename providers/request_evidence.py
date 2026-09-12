"""Safe final request parameters: never headers, credentials or image bytes."""
def safe_request(value, secret='', field=''):
    name=field.lower().replace('_','').replace('-','')
    if any(x in name for x in ('authorization','password','secret','credential','cookie','apikey','keyid','token')) or name=='key':return '[redacted]'
    if name in ('image','images','imageurl','referenceimagemultiple'):
        return {'binaryOmitted':True,'count':len(value) if isinstance(value,list) else 1}
    if isinstance(value,dict):return {k:safe_request(v,secret,str(k)) for k,v in value.items()}
    if isinstance(value,list):return [safe_request(v,secret,field) for v in value]
    if isinstance(value,str):
        if value.startswith(('data:','http://','https://')):return '[media or URL omitted]'
        return value.replace(secret,'[redacted]') if secret else value
    return value

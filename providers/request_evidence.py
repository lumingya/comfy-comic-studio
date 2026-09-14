"""Safe final request parameters: never headers, credentials or image bytes."""
def safe_request(value, secret='', field=''):
    name=field.lower().replace('_','').replace('-','')
    if any(x in name for x in ('authorization','password','secret','credential','cookie','apikey','keyid','token')) or name=='key':return '[redacted]'
    if name in ('image','images','imageurl','referenceimagemultiple','b64json','imagedata'):
        return {'binaryOmitted':True,'count':len(value) if isinstance(value,list) else 1}
    if isinstance(value,dict):return {k:safe_request(v,secret,str(k)) for k,v in value.items()}
    if isinstance(value,list):return [safe_request(v,secret,field) for v in value]
    if isinstance(value,str):
        if value.startswith(('data:','http://','https://')):return '[media or URL omitted]'
        return value.replace(secret,'[redacted]') if secret else value
    return value


def safe_error_text(text):
    """Keep useful upstream errors, not echoed headers or encoded image payloads."""
    import json
    import re
    prefix=''
    match=re.match(r'^(HTTP \d{3}: )(.*)$',text,re.S)
    if match:prefix,text=match.groups()
    try:
        value=json.loads(text)
    except (ValueError,TypeError):
        cleaned=text
    else:
        cleaned=json.dumps(safe_request(value),ensure_ascii=False)
    cleaned=re.sub(r'(?i)(authorization\s*[=:]\s*)(?:bearer\s+|basic\s+)?[^\s,;"}]+',r'\1[redacted]',cleaned)
    cleaned=re.sub(r'[A-Za-z0-9+/]{512,}={0,2}','[encoded payload omitted]',cleaned)
    return prefix+cleaned[:16384]+('… [diagnostic truncated]' if len(cleaned)>16384 else '')

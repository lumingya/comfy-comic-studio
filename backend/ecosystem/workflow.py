"""Saved ComfyUI input mapping for prerequisite assets; no node-ID guesses."""
import copy
import json
import math
import re
from backend.mio_library import LibraryError

def compile_workflow(workflow,bindings,prompt,options,images):
    workflow=copy.deepcopy(workflow);seen=set();variables=options.get('variables',{})
    def text(value):
        return re.sub(r'\{([\w]+)\}',lambda m:str(variables[m[1]]) if m[1] in variables else m[0],str(value or ''))
    for b in bindings:
        if not b.get('enabled') or b.get('source')=='inherit':continue
        source=b.get('source')
        if source=='sceneParameter' and not options.get('renderOverride'):continue
        node=workflow.get(str(b.get('nodeId')))
        if not isinstance(node,dict) or not isinstance(node.get('inputs'),dict):raise LibraryError('Workflow binding node missing')
        path=str(b.get('path',''));parts=[p.replace('~1','/').replace('~0','~') for p in path[1:].split('/')] if path.startswith('/') else path.split('.')
        if not all(parts) or any(p in ('__proto__','constructor','prototype') for p in parts):raise LibraryError('Invalid workflow input path')
        address=(str(b.get('nodeId')),tuple(parts))
        if address in seen:raise LibraryError('Duplicate enabled workflow binding')
        seen.add(address);target=node['inputs']
        for part in parts[:-1]:
            if isinstance(target,list):
                if not part.isdigit() or int(part)>=len(target):raise LibraryError('Workflow array index missing')
                target=target[int(part)]
            else:
                if part not in target:
                    if not b.get('allowCreate'):raise LibraryError('Workflow path missing')
                    target[part]={}
                target=target[part]
        key=int(parts[-1]) if isinstance(target,list) and parts[-1].isdigit() else parts[-1]
        exists=(isinstance(key,int) and key<len(target)) if isinstance(target,list) else key in target
        if not exists and (not b.get('allowCreate') or isinstance(target,list)):raise LibraryError('Workflow field missing')
        original=target[key] if exists else None
        link=isinstance(original,list) and len(original)==2 and str(original[0]) in workflow and isinstance(original[1],int)
        if link and not b.get('allowLink'):raise LibraryError('Mapping would overwrite a node connection')
        values={'positive':prompt,'negative':options.get('negative',''),'random':options.get('seed',1),'bookTitle':options.get('title','前置资产'),'sceneName':options.get('sceneName',options.get('title','前置资产')),'caption':options.get('caption','')}
        if source=='variable':
            name=str(b.get('value','')).strip('{}')
            if name not in variables or variables[name] in (None,''):continue
            value=variables[name]
            if isinstance(value,dict) and value.get('kind')=='mio-image':images.append(value['src']);value='mio-image://'+str(len(images))
        elif source=='image':
            if not images:continue
            value='mio-image://1'
        elif source=='literal':value=text(b.get('value',''))
        elif source=='sceneParameter':
            if b.get('value') not in options:raise LibraryError('Missing mapped frame parameter')
            value=options[b['value']]
        elif source in values:value=values[source]
        else:raise LibraryError('Unsupported workflow source: '+str(source))
        typ=b.get('type','auto')
        if typ=='auto':typ='boolean' if isinstance(original,bool) else 'number' if isinstance(original,(int,float)) else 'json' if isinstance(original,(dict,list)) else 'text'
        if typ=='number':
            try:value=float(value)
            except (ValueError,TypeError):raise LibraryError('Mapped value is not a number') from None
            if not math.isfinite(value):raise LibraryError('Mapped number is not finite')
            if value.is_integer():value=int(value)
        elif typ=='boolean':
            if value in (True,'true','1',1):value=True
            elif value in (False,'false','0',0):value=False
            else:raise LibraryError('Mapped boolean requires true/false or 1/0')
        elif typ=='json':value=json.loads(value) if isinstance(value,str) else value
        elif typ=='text':value=json.dumps(value,ensure_ascii=False) if isinstance(value,(dict,list)) else str(value if value is not None else '')
        else:raise LibraryError('Unsupported workflow value type')
        target[key]=value
    return workflow

"""OpenAPI foundation contracts, independent of browser state or provider transport."""
def extend(spec):
    schemas=spec['components']['schemas'];ref=lambda n:{'$ref':'#/components/schemas/'+n}
    schemas['Artifact']={'type':'object','required':['kind','url'],'properties':{'kind':{'const':'image'},'url':{'type':'string'},'mime':{'type':'string'},'bytes':{'type':'integer','minimum':0}}}
    schemas['ProviderConfig']['properties']['extraParams']={'type':'object','maxProperties':100,'description':'Additional protocol parameters; bound fields and credentials cannot be overridden.'}
    schemas['GenerationResult']['properties'].update(artifacts={'type':'array','items':ref('Artifact')},contractVersion={'const':1},appliedExtraParams={'type':'array','items':{'type':'string'}})
    schemas['JobFrame']={'type':'object','additionalProperties':False,'required':['config'],'properties':{
        'channelId':{'type':'string','minLength':1,'maxLength':150,'description':'Stable saved channel reference. Latest saved model, endpoint, protocol, parameters and credential binding are resolved before each request; missing channel fails without snapshot fallback.'},
        'config':{'type':'object','description':'Cloud ProviderConfig or {provider:comfyui,baseUrl,outputNodeId}. Stored/environment credentials only.'},
        'prompt':{'type':'string'},'negative':{'type':'string'},'images':{'type':'array','maxItems':32,'items':{'type':'string','pattern':'^/images/'}},
        'frameIndex':{'type':'integer','minimum':0,'maximum':9999,'description':'Original zero-based storyboard index, including subset jobs.'},'source':{'type':['string','null']},'albumId':{'type':'string'},'frame':{'type':'object'},'workflow':{'type':'object','description':'ComfyUI API graph; mio-image://N strings are replaced with uploaded image filenames.'}}}
    schemas['JobInput']={'type':'object','additionalProperties':False,'required':['frames'],'properties':{
        'frames':{'type':'array','minItems':1,'maxItems':1000,'items':ref('JobFrame')},'hold':{'type':'boolean'},'label':{'type':'string'},'albumId':{'type':'string'},'owner':{'type':'string','description':'Opaque integration correlation ID; not a user permission boundary.'}}}
    schemas['SubmitJob']={'type':'object','required':['idempotencyKey','input'],'properties':{'idempotencyKey':{'type':'string','minLength':1,'maxLength':160},'input':ref('JobInput')}}
    schemas['Job']={'type':'object','required':['id','state','cursor','total','results'],'properties':{'id':{'type':'string'},'state':{'enum':['pending','paused','running','complete','failed','unknown','canceled','archived']},'cursor':{'type':'integer'},'total':{'type':'integer'},'results':{'type':'array','items':{'type':'object'}},'error':{'type':['object','null']},'upstream':{'type':['string','null']},'provider':{'type':'string'}}}
    schemas['FailurePolicy']={'type':'object','additionalProperties':False,'properties':{'mode':{'enum':['pause','retry','continue'],'default':'retry','description':'Failure behavior within one task; never pauses other manually started tasks.'},'maxRetries':{'type':'integer','minimum':1,'maximum':100,'default':5},'delaySeconds':{'type':'integer','minimum':5,'maximum':300,'default':15},'onExhausted':{'enum':['pause','continue'],'default':'continue'}}}
    schemas['Job']['properties'].update(retry_count={'type':'integer'},ready_at={'type':'number'},attempts={'type':'integer'},errors={'type':'array','description':'Last 30 attempt errors; detail endpoint only','items':{'type':'object'}})
    schemas['Job']['properties'].update(editableFrames={'type':'array','description':'Unfinished resolved cloud prompts; modify only through the audited amend operation.','items':{'type':'object'}},revisions={'type':'array','description':'Explicit before/after prompt revision history.','items':{'type':'object'}})
    schemas['Runtime']={'type':'object','additionalProperties':False,'properties':{'concurrency':{'type':'integer','minimum':1,'maximum':16,'default':1,'description':'Independent in-flight frame limit PER TASK. Default tasks run FIFO; explicit start adds another pool.'},'requestTimeoutSeconds':{'type':'integer','minimum':30,'maximum':7200,'default':600}}}
    schemas['Recovery']={'type':'object','required':['expectedCursor','expectedUpdated'],'properties':{'expectedCursor':{'type':'integer','minimum':0},'expectedUpdated':{'type':'number'},'acknowledgeUnconfirmed':{'type':'boolean','description':'Must be true for unknown results; caller accepts possible duplicate billing for this frame.'}}}
    schemas['Job']['properties'].update(updated={'type':'number'},active_timeout={'type':'integer'},frameIndices={'type':'array','items':{'type':'integer'}},nextFrameIndex={'type':['integer','null']})
    schemas['Job']['properties'].update(currentChannels={'type':'array','items':{'type':'object'},'description':'Safe server-saved configuration preview for subsequent requests; not the model of an already-running attempt.'},channelRefs={'type':'array','items':{'type':'object'}},requestHistory={'type':'array','items':{'type':'object'},'description':'Latest 100 prepared attempt inputs: local index, attempt, timestamp, hash, prompt, negative, images, config and frame parameters. Not proof the upstream accepted a request.'},executionModel={'const':'per-task-frame-pools'},progressVersion={'const':2},cursor={'type':'integer','description':'Confirmed result count, NOT a contiguous prefix or next frame index.'},nextIndex={'type':['integer','null']},running_count={'type':'integer'},enabled={'type':'integer'},blocked={'type':'integer'},completedIndices={'type':'array','items':{'type':'integer'}},runningIndices={'type':'array','items':{'type':'integer'}},frameStates={'type':'array','items':{'type':'object'},'description':'Independent states by task-local frame index, including skipped (HTTP 422), sparse completion, attempt counts, retry deadlines and upstream IDs.'})
    paths={
      '/jobs':{'get':('List active jobs and recent history (up to 2000)',None), 'post':('Persist an immutable job with idempotent submission','SubmitJob')},
      '/jobs/{id}':{'get':('Read durable status, upstream ID and artifacts',None),'post':('Control one job or scheduler',{'type':'object','required':['action'],'properties':{'action':{'enum':['pause','resume','cancel','remove','reconcile','abandon','archive','retry','policy','continue','runtime','hold','amend','start','defer']},'policy':ref('FailurePolicy'),'runtime':ref('Runtime'),'recovery':ref('Recovery'),'edits':{'type':'array','items':{'type':'object','required':['index'],'additionalProperties':False,'properties':{'index':{'type':'integer','minimum':0},'prompt':{'type':'string','maxLength':100000},'negative':{'type':'string','maxLength':100000}}}}}})},
      '/jobs/reorder':{'post':('Reorder not-yet-started waiting jobs',{'type':'object','required':['ids'],'properties':{'ids':{'type':'array','uniqueItems':True,'items':{'type':'string'}}}})},
      '/jobs/activity':{'get':('Read the latest 200 persisted execution records after an optional event ID',None)},
      '/jobs/events':{'get':('Replay SSE events; reconnect using Last-Event-ID or after',None)},
      '/assets/upload':{'post':('Upload an immutable local input asset',{'type':'object','required':['dataUrl'],'properties':{'dataUrl':{'type':'string'},'name':{'type':'string'}}})},
      '/assets/catalog':{'get':('Asset metadata, provenance, references, missing files and cleanup preview',None)},
      '/assets/cleanup':{'post':('Explicitly recycle previewed orphan files older than 24 hours',{'type':'object','required':['token','paths'],'properties':{'token':{'type':'string'},'paths':{'type':'array','items':{'type':'string'}}}})},
      '/resources/{kind}':{'get':('Read editable storyboard/plan DTOs and a workspace revision',None),'post':('Revision-checked storyboard/plan upsert; no full-state overwrite',{'type':'object','required':['expectedRevision','item'],'properties':{'expectedRevision':{'type':['integer','null']},'item':{'type':'object'}}})}
    }
    security=spec.get('security',[{'BearerAuth':[]}])
    for path,methods in paths.items():
        entry={}
        for method,(summary,body) in methods.items():
            op={'summary':summary,'operationId':method+'_foundation_'+path.strip('/').replace('/','_').replace('{','').replace('}',''),'security':security,'responses':{str(c):{'description':'Success' if c==200 else 'Error'} for c in (200,400,401,403,404,409,413,500,503)}}
            if body:op['requestBody']={'required':True,'content':{'application/json':{'schema':ref(body) if isinstance(body,str) else body}}}
            params=[]
            if '{id}' in path:params.append({'name':'id','in':'path','required':True,'schema':{'type':'string'},'description':'Job ID, or scheduler for global pause/resume, failure policy or runtime settings'})
            if '{kind}' in path:params.append({'name':'kind','in':'path','required':True,'schema':{'enum':['storyboards','plans']}})
            if path in ('/jobs/events','/jobs/activity'):params.append({'name':'after','in':'query','schema':{'type':'integer','minimum':0}})
            if path=='/assets/catalog':params.append({'name':'verify','in':'query','schema':{'enum':['0','1']},'description':'Recompute all content hashes when 1'})
            if params:op['parameters']=params
            if path in ('/jobs/events','/jobs/activity'):op['responses']['200']['content']={'text/event-stream':{'schema':{'type':'string'}}}
            else:op['responses']['200']['content']={'application/json':{'schema':{'type':'object','required':['data','requestId'],'properties':{'data':ref('Job') if path=='/jobs/{id}' and method=='get' else {'type':'object'},'requestId':{'type':'string'}}}}}
            if path=='/jobs' and method=='get':op['description']='Lightweight active/recent task summaries (up to 2000). Results are empty in this list; use GET /api/v1/jobs/{id} for complete artifact lists and original sanitized errors.'
            entry[method]=op
        spec['paths']['/api/v1'+path]=entry
    return spec

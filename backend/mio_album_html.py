"""Import inert HTML as data only. HTML/scripts are never executed or fetched."""
import base64
import copy
import math
from html.parser import HTMLParser
import uuid
from backend.mio_library import LibraryError, MAX_BUNDLE, MAX_DOCUMENT, decode, encode, image_type, digest
from backend.mio_resource_sharing import validate_content

class AlbumParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True);self.metadata=[];self.capture=False;self.assets={};self.legacy=[];self.book=None;self.frame=None;self.caption=False;self.title=False;self.ignored=False
    def handle_starttag(self,tag,attrs):
        a=dict(attrs)
        if tag=='script':
            self.ignored=True
            if a.get('id')=='mio-album-data':
                if a.get('type')!='application/json' or self.metadata:raise LibraryError('重复或非法的画册元数据。')
                self.metadata.append('');self.capture=True
        if tag=='img' and 'data-mio-asset' in a:
            key=a['data-mio-asset']
            if key in self.assets:raise LibraryError('重复的图片资源标识。')
            self.assets[key]=a.get('src','')
        if 'data-cc-book' in a:
            self.book={'title':'导入的画册','steps':[]};self.legacy.append(self.book)
        if 'data-cc-frame' in a and self.book is not None:
            self.frame={'stepIndex':len(self.book['steps']),'name':'','caption':'','image':''};self.book['steps'].append(self.frame)
        if tag=='img' and self.frame is not None and not self.frame['image']:
            self.frame.update(image=a.get('src',''),name=a.get('alt',''))
        if 'data-cc-caption' in a:self.caption=True
        if tag=='h1' and self.book is not None:self.title=True;self.book['title']=''
    def handle_endtag(self,tag):
        if tag=='script':self.capture=False;self.ignored=False
        if tag=='figcaption':self.caption=False
        if tag=='figure':self.frame=None
        if tag=='h1':self.title=False
        if tag=='article':self.frame=None;self.book=None
    def handle_data(self,data):
        if self.capture:self.metadata[-1]+=data
        elif not self.ignored:
            if self.caption and self.frame is not None:self.frame['caption']+=data
            if self.title and self.book is not None:self.book['title']+=data


def parse(store,html):
    if not isinstance(html,str) or len(html.encode('utf-8'))>MAX_BUNDLE:raise LibraryError('HTML 画册最大 192 MiB。',413)
    parser=AlbumParser();parser.feed(html);parser.close()
    if parser.metadata:
        if len(parser.metadata[0].encode())>MAX_DOCUMENT:raise LibraryError('元数据超过 16 MiB。',413)
        payload=decode(parser.metadata[0].encode())
        if not isinstance(payload,dict) or payload.get('schema')!='mio.album-html.v1':raise LibraryError('不支持此画册元数据版本。')
    else:
        # Older Mio exports: only designated frame images and captions, never arbitrary web pages.
        payload={'schema':'mio.album-html.v1','books':[]}
        for b in parser.legacy:
            if not b['steps']:continue
            for step in b['steps']:
                key='legacy_'+str(len(parser.assets));parser.assets[key]=step['image'];step['image']={'$mioImage':key}
            b['totalSteps']=len(b['steps']);payload['books'].append({'album':b})
    books=payload.get('books')
    if not isinstance(books,list) or not 1<=len(books)<=64:raise LibraryError('没有可导入的 Mio 画册（最多 64 本）。')
    if len(parser.assets)>2048:raise LibraryError('画册图片最多 2048 个。',413)
    assets={};size=0
    for key,src in parser.assets.items():
        if not isinstance(src,str) or not src.startswith('data:image/'):raise LibraryError('HTML 图片必须完整内联；不会读取外部网址或本机文件。')
        raw,name=store.image_bytes(src);mime,_=image_type(raw);assets[key]=('images/'+name,'data:'+mime+';base64,'+base64.b64encode(raw).decode());size+=len(raw)
        if size>MAX_BUNDLE:raise LibraryError('图片总量超过 192 MiB。',413)
    def refs(value,inline=False):
        if isinstance(value,dict) and set(value)=={'$mioImage'}:
            key=value['$mioImage']
            if not isinstance(key,str) or key not in assets:raise LibraryError('元数据引用的图片不在文件中。')
            return assets[key][1 if inline else 0]
        if isinstance(value,list):return [refs(v,inline) for v in value]
        if isinstance(value,dict):return {k:refs(v,inline) for k,v in value.items()}
        return value
    return validate_books(store,books,refs),assets,refs


def validate_books(store,books,refs):
    clean=[]
    if not isinstance(books,list) or not 1<=len(books)<=64:raise LibraryError('画册数量应为 1 至 64。')
    def frames(value):
        if not isinstance(value,list) or len(value)>512 or any(not isinstance(f,dict) for f in value):raise LibraryError('分镜必须为最多 512 个对象。')
        for f in value:
            if any(k in f and not isinstance(f[k],str) for k in ('name','caption','prompt','negative')):raise LibraryError('分镜文字必须是字符串。')
            if 'renderOverride' in f and type(f['renderOverride']) is not bool:raise LibraryError('分镜参数开关必须是布尔值。')
            for k in ('width','height','steps','cfg','denoise','seed'):
                if k in f and (type(f[k]) not in (int,float) or not math.isfinite(f[k])):raise LibraryError('分镜参数必须是有限数字。')
        return value
    album_fields={'title','characterName','synopsis','tags','totalSteps','steps','coverPresentation'}
    frame_fields={'id','stepIndex','name','caption','prompt','negative','width','height','steps','cfg','denoise','seed','renderOverride','image'}
    for book in books:
        if not isinstance(book,dict) or not isinstance(book.get('album'),dict):raise LibraryError('画册元数据结构不完整。')
        album={k:v for k,v in book['album'].items() if k in album_fields};album.update(id='inspect',kind='albums',schema='mio.resource.v2')
        if not isinstance(album.get('steps'),list):raise LibraryError('画册缺少分镜。')
        album['steps']=[{k:v for k,v in f.items() if k in frame_fields} for f in frames(album['steps'])]
        validate_content(store,'albums',refs(album));item={'album':album}
        if book.get('storyboard') is not None:
            t=book['storyboard']
            if not isinstance(t,dict) or not isinstance(t.get('frames'),list):raise LibraryError('附带分镜结构不完整。')
            t={'id':'inspect','title':t.get('title'),'outline':t.get('outline',''),'frames':[{k:v for k,v in f.items() if k in frame_fields and k!='image'} for f in frames(t['frames'])]}
            validate_content(store,'storyboards',t);item['storyboard']=t
        if book.get('variables') is not None:
            v=book['variables']
            if not isinstance(v,dict) or not isinstance(v.get('frames',{}),dict):raise LibraryError('附带变量结构不完整。')
            v={'id':'inspect','title':v.get('title'),'entries':v.get('entries'),'frames':v.get('frames',{})}
            validate_content(store,'characters',refs(v))
            for index,entries in v['frames'].items():
                if not str(index).isdigit() or not 0<=int(index)<512:raise LibraryError('单幕变量索引非法。')
                validate_content(store,'characters',refs({'id':'inspect','title':'frame','entries':entries}))
            item['variables']=v
        clean.append(item)
    return clean


def inspect(store,body):
    books,assets,_=parse(store,body['html'])
    return {'ok':True,'kind':'albums','title':books[0]['album']['title'] if len(books)==1 else str(len(books))+' 本画册',
            'count':sum(len(x['album']['steps']) for x in books),'images':len(assets),
            'storyboards':sum('storyboard' in x for x in books),'variables':sum('variables' in x for x in books)}


def import_html(store,body):
    books,assets,refs=parse(store,body['html'])
    return import_books(store,body,books,refs)


def import_books(store,body,books,refs):
    project=body.get('projectId');store.library.get('collections',project)
    choices=body.get('include',{})
    if not isinstance(choices,dict):raise LibraryError('导入选项必须是对象。')
    if any(type(choices.get(k,False)) is not bool for k in ('storyboards','variables')):raise LibraryError('请选择是否导入附带素材。')
    changes=[];ids=[]
    def new(kind,value):
        doc=refs(copy.deepcopy(value),True);doc.update(id=kind+'_'+uuid.uuid4().hex,projectId=project)
        doc.pop('kind',None);doc.pop('schema',None)
        for field in ('frames','entries'):
            if isinstance(doc.get(field),list):
                for entry in doc[field]:entry['id']='item_'+uuid.uuid4().hex
        if kind=='characters' and isinstance(doc.get('frames'),dict):
            for entries in doc['frames'].values():
                for entry in entries:entry['id']='item_'+uuid.uuid4().hex
        changes.append({'kind':kind,'id':doc['id'],'document':doc,'expected':None});return doc
    for item in books:
        t=new('storyboards',item['storyboard']) if choices.get('storyboards') and 'storyboard' in item else None
        v=new('characters',item['variables']) if choices.get('variables') and 'variables' in item else None
        album=new('albums',item['album']);album.update(inProgress=False,status='complete' if len(album['steps'])==album.get('totalSteps',len(album['steps'])) and all(s.get('image') for s in album['steps']) else 'partial',generatedSteps=sum(bool(s.get('image')) for s in album['steps']))
        if t:
            row=new('rows',{'title':album['title'],'bookTitle':album['title'],'character':album.get('characterName',''),'style':'','outfit':'','active':False,'storyVersions':{},'activeStoryVersionIds':{},'references':{}})
            plan=new('plans',{'title':album['title'],'templateId':t['id'],'rowId':row['id'],'enabled':False,'variableSetIds':[v['id']] if v else [],'variables':[],'sceneOverrides':{}})
            if v:
                for index,entries in item['variables'].get('frames',{}).items():
                    if int(index)<len(t['frames']):plan['sceneOverrides'][t['frames'][int(index)]['id']]={'variables':[{**refs(e,True),'id':'item_'+uuid.uuid4().hex} for e in entries]}
            album.update(templateId=t['id'],templateTitle=t['title'],rowId=row['id'])
        if v:album['importedVariableSetIds']=[v['id']]
        ids.append(album['id'])
    store.apply(changes)
    return {'ok':True,'kind':'albums','id':ids[0],'ids':ids}

"""Non-destructive per-scene image overrides, independent of generation results.

The SQLite override is authoritative over old workspace saves and late job results.
Image removal removes an image, not a storyboard slot, and never submits generation.
"""
import copy
from contextlib import closing
import json
import math
import os
import re
import sqlite3
import time
from mio_jobs import Conflict

SCHEMA = '''CREATE TABLE IF NOT EXISTS picture_edits(
seq INTEGER PRIMARY KEY AUTOINCREMENT, album TEXT NOT NULL, idx INTEGER NOT NULL,
revision INTEGER NOT NULL, record TEXT NOT NULL, UNIQUE(album,idx));'''


def same_image(a, b):
    if a == b:return True
    # Owned and staging URLs can name the same immutable bytes after materialization.
    if not isinstance(a,str) or not isinstance(b,str) or not a.startswith('/images/') or not b.startswith('/images/'):return False
    name=a.rsplit('/',1)[-1]
    return bool(re.fullmatch(r'[a-f0-9]{64}\.(png|jpg|jpeg|webp|svg)',name)) and b.rsplit('/',1)[-1]==name


def records(root, after=None):
    path = os.path.join(root, 'runtime', 'execution', 'jobs.sqlite3')
    if not os.path.isfile(path):
        return []
    with closing(sqlite3.connect(path, timeout=30)) as db:
        if not db.execute("SELECT 1 FROM sqlite_master WHERE name='picture_edits'").fetchone():
            return []
        rows = db.execute('SELECT seq,album,idx,revision,record FROM picture_edits' +
                          (' WHERE seq>? ORDER BY seq LIMIT 200' if after is not None else ' ORDER BY seq'),
                          (after,) if after is not None else ()).fetchall()
    return [{'seq':r[0], 'albumId':r[1], 'index':r[2], 'revision':r[3], **json.loads(r[4])} for r in rows]


def apply_record(book, record):
    index = record['index']
    if not 0 <= index < book.get('totalSteps', 0):
        return
    step = next((s for s in book.setdefault('steps', []) if s.get('stepIndex') == index), None)
    if step is None:
        frames = book.get('sourceSnapshot', {}).get('frames', [])
        frame = frames[index] if index < len(frames) else {}
        step = {k:str(frame.get(k, '')) for k in ('name', 'caption', 'prompt')}
        step.update(stepIndex=index, image='')
        book['steps'].append(step)
    step.update(image=record['image'], width=record.get('width', 0), height=record.get('height', 0),
                visualRevision=record['revision'], deletedImage=record.get('removed', False), offlineFallback=False)
    for key in ('critique', 'offlineImage'):
        step.pop(key, None)
    book.setdefault('pictureEdits', {})[str(index)] = record
    book['steps'].sort(key=lambda s:s['stepIndex'])
    book['generatedSteps'] = sum(bool(s.get('image')) for s in book['steps'])
    if not book.get('inProgress'):
        book['status'] = 'complete' if book['generatedSteps'] == book.get('totalSteps') else 'partial'


def project(config, root):
    books = {b.get('id'):b for b in config.get('savedGalleries', [])}
    if books:
        for record in records(root):
            if record['albumId'] in books:
                apply_record(books[record['albumId']], record)
    return config


def validate_recipe(recipe, image_check):
    if not isinstance(recipe, dict) or len(json.dumps(recipe)) > 180000:
        raise ValueError('编辑图层数据过大或格式不合法。')
    if set(recipe) - {'version','crop','rotation','flipX','flipY','brightness','contrast','saturation','layers'}:
        raise ValueError('未知编辑字段。')
    crop = recipe.get('crop', {})
    if not isinstance(crop, dict) or set(crop) != {'x','y','w','h'}:
        raise ValueError('裁剪范围不完整。')
    def finite(value, low, high):
        return type(value) in (int,float) and math.isfinite(value) and low <= value <= high
    if not all(finite(crop[k], 0, 1) for k in crop) or crop['w'] <= 0 or crop['h'] <= 0 or crop['x']+crop['w'] > 1.001 or crop['y']+crop['h'] > 1.001:
        raise ValueError('裁剪范围超出原图。')
    if recipe.get('rotation',0) not in (0,90,180,270):
        raise ValueError('旋转角度不合法。')
    for key in ('brightness','contrast','saturation'):
        if not finite(recipe.get(key,1),0,2):raise ValueError('调色参数不合法。')
    layers=recipe.get('layers',[])
    if not isinstance(layers,list) or len(layers)>40:
        raise ValueError('每张图片最多 40 个图层。')
    for layer in layers:
        if not isinstance(layer,dict) or layer.get('kind') not in ('bubble','text','sticker'):
            raise ValueError('图层类型不合法。')
        if not all(finite(layer.get(k),0,1) for k in ('x','y','w','h')) or not layer['w'] or not layer['h']:
            raise ValueError('图层范围不合法。')
        if not isinstance(layer.get('text',''),str) or len(layer.get('text',''))>2000:
            raise ValueError('图层文字最多 2000 字。')
        if not finite(layer.get('fontSize',4),1,15):raise ValueError('字号不合法。')
        for color in ('color','fill','stroke'):
            if color in layer and not re.fullmatch(r'#[0-9a-fA-F]{6}',str(layer[color])):raise ValueError('颜色不合法。')
        if layer.get('shape','round') not in ('round','ellipse','thought','shout','rect'):raise ValueError('气泡形状不合法。')
        if layer.get('tail','left') not in ('left','right','none'):raise ValueError('气泡尾部不合法。')
        if layer.get('asset'):image_check(layer['asset'])
    return copy.deepcopy(recipe)


def mutate(host, store, body):
    if not isinstance(body,dict) or set(body)-{'albumId','index','action','expectedRevision','expectedImage','image','sourceImage','recipe'}:
        raise ValueError('图片操作格式不合法。')
    album,index,action=body.get('albumId'),body.get('index'),body.get('action')
    if not isinstance(album,str) or type(index) is not int or action not in ('save','remove','restore'):
        raise ValueError('请选择画册、分镜和有效图片操作。')
    def check_image(url,editing=True):
        if not isinstance(url,str) or not url.startswith('/images/'):
            raise ValueError('请先上传本地图片素材。')
        path=host.local_path_from_url(url)
        with open(path,'rb') as f:header=f.read(65536)
        mime=host.detect_image_mime_type(header)
        if mime not in ('image/png','image/jpeg','image/webp','image/gif'):
            raise ValueError('仅支持安全的位图图片。')
        from mio_foundation import image_dimensions
        width,height=image_dimensions(header,mime)
        if editing and width and height and (width>8192 or height>8192 or width*height>32000000):
            raise ValueError('编辑图片上限为 3200 万像素、长边 8192 px。')
        return width,height
    with store.lock,host.CONFIG_LOCK:
        config=host.read_merged_config()
        book=next((b for b in config.get('savedGalleries',[]) if b.get('id')==album),None)
        if not book or not 0<=index<book.get('totalSteps',0):
            raise Conflict('画册或分镜已不存在，未覆盖任何图片。')
        current=next((s for s in book.get('steps',[]) if s.get('stepIndex')==index),{})
        old=book.get('pictureEdits',{}).get(str(index),{})
        if body.get('expectedRevision') != old.get('revision',0) or not same_image(body.get('expectedImage'), current.get('image','')):
            raise Conflict('此图已被生成结果或另一页面更新。草稿仍保留，请重新打开当前图片后再编辑。')
        original=old.get('originalImage') or current.get('image','')
        if original.startswith(('data:image/png;', 'data:image/jpeg;', 'data:image/webp;', 'data:image/gif;')):
            original=host.store_image_data(original,album)
        if action=='save':
            width,height=check_image(body.get('image'))
            source=body.get('sourceImage');check_image(source)
            recipe=validate_recipe(body.get('recipe'),check_image)
            record={'image':body['image'],'sourceImage':source,'recipe':recipe,'removed':False,'width':width or 0,'height':height or 0}
        elif action=='remove':
            record={**old,'image':'','removed':True,'previousImage':current.get('image','')}
        else:
            if not original:raise ValueError('没有可恢复的原图，请替换为本地图片。')
            width,height=check_image(original,False) if original.startswith('/images/') else (0,0)
            record={'image':original,'sourceImage':original,'recipe':None,'removed':False,'width':width or 0,'height':height or 0}
        for key in ('seq','albumId','index','revision'):record.pop(key,None)
        record.update(originalImage=original or record.get('sourceImage',''),updatedAt=int(time.time()*1000))
        revision=old.get('revision',0)+1
        with store.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            if db.execute('SELECT 1 FROM deleted_albums WHERE id=?',(album,)).fetchone():
                raise Conflict('画册已删除。')
            db.execute('INSERT OR REPLACE INTO picture_edits(album,idx,revision,record) VALUES(?,?,?,?)',(album,index,revision,json.dumps(record)))
            seq=db.execute('SELECT seq FROM picture_edits WHERE album=? AND idx=?',(album,index)).fetchone()[0]
        result={'seq':seq,'albumId':album,'index':index,'revision':revision,**record}
        apply_record(book,result)
        # Visual revisions are independent of workspace CAS; raw reads/writes project
        # the durable record. Do not invalidate unrelated unsaved storyboard edits.
        return {'edit':result}

def setup(ctx):
    @ctx.route('/notes',method='GET')
    def list_notes(query):
        return ctx.storage.get('notes',[])

    @ctx.route('/notes',method='POST')
    def add_note(body):
        notes=ctx.storage.get('notes',[])
        notes.append({'title':str(body.get('title',''))[:120],'text':str(body.get('text',''))[:2000],'createdAt':body.get('createdAt')})
        ctx.storage.set('notes',notes[-1000:])
        return {'saved':True}

def on_unload(ctx):
    ctx.log('Scene notebook disabled; user data retained.')

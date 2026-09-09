import fs from 'node:fs';
import {parse} from 'acorn';
const files=['state','sync','engine','creation','ui','workspace','organize','app'];
const globals={ComfyComic:'writable'};
for(const f of files){for(const n of parse(fs.readFileSync(`js/${f}.js`,'utf8'),{ecmaVersion:'latest'}).body){if(n.type==='FunctionDeclaration')globals[n.id.name]='writable';if(n.type==='VariableDeclaration')for(const d of n.declarations)if(d.id.type==='Identifier')globals[d.id.name]='writable';}}
const config=JSON.parse(fs.readFileSync('.eslintrc.json','utf8'));config.globals=globals;config.overrides=[{files:['js/build.js','js/tests.js','tools/*.mjs','tests/*.mjs'],env:{node:true},parserOptions:{sourceType:'module'}}];fs.writeFileSync('.eslintrc.json',JSON.stringify(config,null,2)+'\n');

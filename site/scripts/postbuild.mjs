import {mkdir,copyFile} from 'node:fs/promises';
for (const route of ['app','connect','privacy','mobile-connect']) { await mkdir('dist/'+route,{recursive:true}); await copyFile('dist/index.html','dist/'+route+'/index.html'); }

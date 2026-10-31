import {mkdir,copyFile} from 'node:fs/promises';
// /app is its own page (app.html, the desktop dashboard); the other routes are the site's single page.
for (const route of ['app','sign-in','connect','privacy','mobile-connect','settings']) { await mkdir('dist/'+route,{recursive:true}); await copyFile(route==='app'?'dist/app.html':'dist/index.html','dist/'+route+'/index.html'); }

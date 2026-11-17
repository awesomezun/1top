import {defineConfig} from 'vite';
import {fileURLToPath} from 'node:url';
import {dashboardPages} from './scripts/dashboard-pages.mjs';

const page=name=>fileURLToPath(new URL(name,import.meta.url));
export default defineConfig({plugins:[dashboardPages()],build:{rollupOptions:{input:{main:page('index.html'),app:page('app.html')}}}});

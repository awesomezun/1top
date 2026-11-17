import { defineConfig } from 'vitest/config';
import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
export default defineConfig({define:{__ONETOP_BENCHMARK__:JSON.stringify(process.env.ONETOP_BENCHMARK==='1')},plugins:[cloudflareTest({wrangler:{configPath:'./wrangler.jsonc'}})],test:{include:['test/**/*.test.ts'],testTimeout:10000}});

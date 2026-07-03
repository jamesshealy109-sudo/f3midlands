import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://jamesshealy109-sudo.github.io',
  base: '/f3midlands',
  integrations: [sitemap()],
  output: 'static'
});

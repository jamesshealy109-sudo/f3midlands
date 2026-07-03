import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
export default defineConfig({ site: 'https://jamesshealy109-sudo.github.io', base: '/f3midlands', integrations: [react()], output: 'static' });

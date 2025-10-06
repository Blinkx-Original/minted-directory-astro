// @ts-check
import { defineConfig, envField } from 'astro/config';
import vue from '@astrojs/vue';
import mdx from '@astrojs/mdx';
import icon from 'astro-icon';
import sitemap from '@astrojs/sitemap';
import { ViteToml } from 'vite-plugin-toml';
import tailwindcss from '@tailwindcss/vite';
import vercel from '@astrojs/vercel/serverless';

// https://astro.build/config
export default defineConfig({
  site: "https://bestmeditationapps.com",
  integrations: [
    vue(),
    mdx(),
    icon(),
    sitemap()
  ],
  adapter: vercel(),
  vite: {
    plugins: [tailwindcss(), ViteToml()]
  },
  env: {
    schema: {
      POSTHOG_API_KEY: envField.string({ context: "client", access: "public", optional: true }),
      POSTHOG_API_HOST: envField.string({ context: "client", access: "public", optional: true }),
      NOTION_TOKEN: envField.string({ context: "server", access: "secret", optional: true }),
      ADMIN_PASSWORD: envField.string({ context: "server", access: "secret", optional: false }),
      R2_ACCOUNT_ID: envField.string({ context: "server", access: "secret", optional: true }),
      R2_BUCKET: envField.string({ context: "server", access: "secret", optional: true }),
      R2_S3_ENDPOINT: envField.string({ context: "server", access: "secret", optional: true }),
      R2_ACCESS_KEY_ID: envField.string({ context: "server", access: "secret", optional: true }),
      R2_SECRET_ACCESS_KEY: envField.string({ context: "server", access: "secret", optional: true }),
      R2_S3_FORCE_PATH_STYLE: envField.string({ context: "server", access: "secret", optional: true }),
      TYPESENSE_HOST: envField.string({ context: "server", access: "secret", optional: true }),
      TYPESENSE_API_KEY: envField.string({ context: "server", access: "secret", optional: true })
    }
  }
});
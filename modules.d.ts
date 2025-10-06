declare module "*.toml" {
  const value: any;
  export default value;
}

declare module '@astrojs/vercel/serverless' {
  import type { AstroIntegration } from 'astro';
  function vercel(options?: Record<string, unknown>): AstroIntegration;
  export default vercel;
}

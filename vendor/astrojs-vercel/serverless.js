import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';

const entrypoint = new URL('./serverless/entrypoint.mjs', import.meta.url);

function vercelServerlessIntegration(options = {}) {
  return {
    name: '@astrojs/vercel/serverless',
    hooks: {
      'astro:config:setup': ({ updateConfig }) => {
        updateConfig({
          output: 'server'
        });
      },
      'astro:config:done': ({ setAdapter }) => {
        setAdapter({
          name: '@astrojs/vercel/serverless',
          serverEntrypoint: entrypoint,
          supportedAstroFeatures: {
            staticOutput: 'stable',
            hybridOutput: 'stable',
            serverOutput: 'stable',
            sharpImageService: 'experimental',
            envGetSecret: 'stable'
          },
          args: options
        });
      },
      'astro:build:done': async ({ dir, logger }) => {
        const clientOutDir = fileURLToPath(dir);
        const distDir = fileURLToPath(new URL('../', dir));
        const projectRoot = fileURLToPath(new URL('../../', dir));
        const vercelOutput = join(projectRoot, '.vercel', 'output');
        const staticDir = join(vercelOutput, 'static');
        const functionsDir = join(vercelOutput, 'functions');
        const functionName = 'astro';
        const functionDir = join(functionsDir, `${functionName}.func`);
        const functionEntry = join(functionDir, 'index.mjs');
        const functionConfig = join(functionDir, '.vc-config.json');

        rmSync(vercelOutput, { recursive: true, force: true });
        mkdirSync(functionDir, { recursive: true });
        mkdirSync(staticDir, { recursive: true });

        const clientDir = clientOutDir;
        const serverDir = join(distDir, 'server');

        if (existsSync(clientDir)) {
          cpSync(clientDir, staticDir, { recursive: true });
        }
        if (existsSync(serverDir)) {
          cpSync(serverDir, functionDir, { recursive: true });
        }

        const relativeServerEntry = './entry.mjs';
        const indexSource = `import handler from ${JSON.stringify(relativeServerEntry)};\n\nexport default async function vercelHandler(req, res) {\n  try {\n    await handler(req, res);\n  } catch (err) {\n    console.error('Astro request failed', err);\n    res.statusCode = 500;\n    res.end('Internal Server Error');\n  }\n}\n`;
        writeFileSync(functionEntry, indexSource, 'utf8');

        const vcConfig = {
          runtime: 'nodejs20.x',
          handler: 'index.mjs',
          launcherType: 'Nodejs'
        };
        writeFileSync(functionConfig, JSON.stringify(vcConfig, null, 2));

        const routesConfig = {
          version: 3,
          routes: [
            { handle: 'filesystem' },
            { src: '/.*', dest: functionName }
          ]
        };
        mkdirSync(join(vercelOutput), { recursive: true });
        writeFileSync(join(vercelOutput, 'config.json'), JSON.stringify(routesConfig, null, 2));

        logger.info('vercel', `Output written to ${vercelOutput}`);
      }
    }
  };
}

export default vercelServerlessIntegration;

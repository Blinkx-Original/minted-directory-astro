import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';

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

        const packageJsonSrc = join(projectRoot, 'package.json');
        const packageJsonDest = join(functionDir, 'package.json');
        if (existsSync(packageJsonSrc)) {
          cpSync(packageJsonSrc, packageJsonDest);
        } else {
          logger.warn('vercel', 'No package.json found in project root; serverless function will not contain dependencies.');
        }

        const lockFiles = ['pnpm-lock.yaml', 'package-lock.json', 'yarn.lock'];
        let copiedLockfile = '';
        for (const lock of lockFiles) {
          const src = join(projectRoot, lock);
          if (existsSync(src)) {
            cpSync(src, join(functionDir, lock));
            copiedLockfile = lock;
            break;
          }
        }

        const installDependencies = () => {
          if (!existsSync(packageJsonDest)) {
            return;
          }

          const installCommands = [
            {
              command: 'pnpm',
              args: ['install', '--prod', '--ignore-scripts', '--frozen-lockfile'],
              condition: () => copiedLockfile === 'pnpm-lock.yaml'
            },
            {
              command: 'yarn',
              args: ['install', '--production', '--ignore-scripts'],
              condition: () => copiedLockfile === 'yarn.lock'
            },
            {
              command: 'npm',
              args: ['install', '--omit=dev', '--ignore-scripts'],
              condition: () => true
            }
          ];

          const { command, args } = installCommands.find(({ condition }) => condition());
          logger.info('vercel', `Installing serverless function dependencies using ${command}...`);
          const result = spawnSync(command, args, {
            cwd: functionDir,
            stdio: 'inherit'
          });

          if (result.error) {
            throw result.error;
          }

          if (result.status !== 0) {
            throw new Error(`Failed to install serverless function dependencies with ${command}.`);
          }
        };

        installDependencies();

        const astroModuleDir = join(functionDir, 'node_modules', 'astro');
        if (!existsSync(astroModuleDir)) {
          throw new Error(
            'Serverless function is missing the Astro runtime. Ensure dependencies are installed correctly.'
          );
        }

        const manifestFile = readdirSync(functionDir).find((file) => file.startsWith('manifest_') && file.endsWith('.mjs'));
        if (!manifestFile) {
          throw new Error('Unable to locate Astro manifest in server output.');
        }

        const hasEntryModule = existsSync(join(functionDir, 'entry.mjs'));
        const entryImport = hasEntryModule ? "import './entry.mjs';\n" : '';
        const indexSource = `${entryImport}import { createExports } from './_@astrojs-ssr-adapter.mjs';\nimport { manifest } from './${manifestFile}';\n\nconst { default: app } = createExports(manifest);\n\nexport default async function vercelHandler(req, res) {\n  try {\n    await app(req, res);\n  } catch (err) {\n    console.error('Astro request failed', err);\n    res.statusCode = 500;\n    res.end('Internal Server Error');\n  }\n}\n`;
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

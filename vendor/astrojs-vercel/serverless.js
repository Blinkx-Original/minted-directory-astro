import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

const entrypoint = new URL('./serverless/entrypoint.mjs', import.meta.url);

const IMPORT_FROM_PATTERN = /import\s+(?:[^'";]+?\sfrom\s*)?['"]([^'"]+)['"]/g;
const DYNAMIC_IMPORT_PATTERN = /import\(\s*['"]([^'"]+)['"]\s*\)/g;
const REQUIRE_PATTERN = /require\(\s*['"]([^'"]+)['"]\s*\)/g;
const PNPM_PATH_PATTERN = /node_modules\/\.pnpm\/[^"'\s]+\/node_modules\/([^"'\s]+)/g;

function loadProjectManifest(projectRoot, logger) {
  const manifestPath = join(projectRoot, 'package.json');
  if (!existsSync(manifestPath)) {
    return null;
  }

  try {
    return JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch (err) {
    logger.warn(
      'vercel',
      `Unable to parse package.json for dependency inspection: ${err instanceof Error ? err.message : String(err)}`
    );
    return null;
  }
}

function collectRuntimePackages(functionDir) {
  const packages = new Set();

  const addPackage = (specifier) => {
    if (
      !specifier ||
      specifier.startsWith('.') ||
      specifier.startsWith('/') ||
      specifier.startsWith('node:') ||
      specifier.includes(':')
    ) {
      return;
    }

    const segments = specifier.split('/');
    if (specifier.startsWith('@') && segments.length > 1) {
      packages.add(`${segments[0]}/${segments[1]}`);
    } else {
      packages.add(segments[0]);
    }
  };

  const addFromNodeModulesPath = (pathSpecifier) => {
    if (!pathSpecifier) {
      return;
    }
    const segments = pathSpecifier.split('/');
    if (!segments.length) {
      return;
    }
    if (segments[0].startsWith('@') && segments.length > 1) {
      packages.add(`${segments[0]}/${segments[1]}`);
    } else {
      packages.add(segments[0]);
    }
  };

  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const entryPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules') {
          continue;
        }
        walk(entryPath);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      if (!entry.name.endsWith('.mjs') && !entry.name.endsWith('.js')) {
        continue;
      }

      const source = readFileSync(entryPath, 'utf8');
      let match;
      while ((match = IMPORT_FROM_PATTERN.exec(source)) !== null) {
        addPackage(match[1]);
      }
      while ((match = DYNAMIC_IMPORT_PATTERN.exec(source)) !== null) {
        addPackage(match[1]);
      }
      while ((match = REQUIRE_PATTERN.exec(source)) !== null) {
        addPackage(match[1]);
      }
      while ((match = PNPM_PATH_PATTERN.exec(source)) !== null) {
        addFromNodeModulesPath(match[1]);
      }
    }
  };

  walk(functionDir);

  return packages;
}

function detectPackageManager(projectRoot) {
  if (existsSync(join(projectRoot, 'pnpm-lock.yaml'))) {
    return 'pnpm';
  }
  if (existsSync(join(projectRoot, 'yarn.lock'))) {
    return 'yarn';
  }
  return 'npm';
}

function removeInstallArtifacts(functionDir) {
  const artifacts = ['node_modules', 'pnpm-lock.yaml', 'package-lock.json', 'yarn.lock'];
  for (const artifact of artifacts) {
    const target = join(functionDir, artifact);
    rmSync(target, { recursive: true, force: true });
  }
}

function runCommand(command, args, options) {
  const result = spawnSync(command, args, options);
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`Failed to install serverless function dependencies with ${command}.`);
  }
}

function installRuntimeDependencies({ functionDir, logger, packageManager }) {
  const spawnOptions = {
    cwd: functionDir,
    stdio: 'inherit'
  };

  const tryPnpmInstall = () => {
    logger.info('vercel', 'Generating pnpm lockfile for runtime dependencies...');
    runCommand('pnpm', ['install', '--prod', '--ignore-scripts', '--lockfile-only'], spawnOptions);
    logger.info('vercel', 'Installing serverless function dependencies using pnpm...');
    runCommand('pnpm', ['install', '--prod', '--ignore-scripts', '--frozen-lockfile'], spawnOptions);
  };

  if (packageManager === 'pnpm') {
    try {
      tryPnpmInstall();
      return;
    } catch (err) {
      if (err instanceof Error && 'code' in err && err.code === 'ENOENT') {
        logger.warn('vercel', 'pnpm is not available in the build environment; falling back to npm.');
      } else {
        throw err;
      }
    }
  }

  if (packageManager === 'yarn') {
    try {
      logger.info('vercel', 'Installing serverless function dependencies using yarn...');
      runCommand('yarn', ['install', '--production', '--ignore-scripts'], spawnOptions);
      return;
    } catch (err) {
      if (err instanceof Error && 'code' in err && err.code === 'ENOENT') {
        logger.warn('vercel', 'yarn is not available in the build environment; falling back to npm.');
      } else {
        throw err;
      }
    }
  }

  logger.info('vercel', 'Installing serverless function dependencies using npm...');
  runCommand('npm', ['install', '--omit=dev', '--ignore-scripts'], spawnOptions);
}

function createRuntimeManifest({ projectManifest, runtimePackages, projectRoot, functionDir, logger }) {
  const dependencySources = [
    projectManifest.dependencies ?? {},
    projectManifest.optionalDependencies ?? {},
    projectManifest.peerDependencies ?? {},
    projectManifest.devDependencies ?? {}
  ];

  const findSpecifier = (name) => {
    for (const source of dependencySources) {
      if (Object.prototype.hasOwnProperty.call(source, name)) {
        return source[name];
      }
    }
    return null;
  };

  const dependencies = new Map();

  for (const pkg of runtimePackages) {
    const specifier = findSpecifier(pkg);
    if (!specifier) {
      throw new Error(`Runtime dependency "${pkg}" is not declared in package.json.`);
    }

    dependencies.set(pkg, specifier);

    if (typeof specifier === 'string' && specifier.startsWith('file:')) {
      const relativePath = specifier.slice('file:'.length);
      const src = join(projectRoot, relativePath);
      const dest = join(functionDir, relativePath);
      if (!existsSync(src)) {
        logger.warn('vercel', `Local dependency path ${relativePath} not found; skipping copy.`);
        continue;
      }
      mkdirSync(dirname(dest), { recursive: true });
      cpSync(src, dest, { recursive: true });
    }
  }

  const sortedDependencies = Object.fromEntries(Array.from(dependencies.entries()).sort(([a], [b]) => a.localeCompare(b)));

  const runtimeManifest = {
    name: projectManifest.name ?? 'astro-server',
    private: true,
    version: projectManifest.version ?? '0.0.0',
    type: projectManifest.type ?? 'module',
    dependencies: sortedDependencies
  };

  if (projectManifest.packageManager) {
    runtimeManifest.packageManager = projectManifest.packageManager;
  }

  if (projectManifest.engines?.node) {
    runtimeManifest.engines = { node: projectManifest.engines.node };
  }

  return runtimeManifest;
}

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

        const projectManifest = loadProjectManifest(projectRoot, logger);
        const packageJsonDest = join(functionDir, 'package.json');
        const runtimePackages = collectRuntimePackages(functionDir);

        if (!runtimePackages.has('astro')) {
          runtimePackages.add('astro');
        }

        if (!projectManifest) {
          logger.warn('vercel', 'No package.json found in project root; skipping dependency installation.');
        } else {
          const runtimeManifest = createRuntimeManifest({
            projectManifest,
            runtimePackages,
            projectRoot,
            functionDir,
            logger
          });

          writeFileSync(packageJsonDest, JSON.stringify(runtimeManifest, null, 2));
          removeInstallArtifacts(functionDir);

          const packageManager = detectPackageManager(projectRoot);
          installRuntimeDependencies({
            functionDir,
            logger,
            packageManager
          });
        }

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

/**
 * Keeps a Remotion bundle inside the teammate's folder. The teammate writes the TSX
 * that webpack bundles in the (unsandboxed) worker, so without this an
 * `import secrets from "/Users/me/.claude/.credentials.json"` or a
 * `require.context("../../..")` would copy those files into the video. Every module,
 * asset and loader webpack resolves must sit inside the task's working folder or
 * Ajudan's own node_modules; anything else fails the build with a readable error.
 */
import fs from "node:fs";
import path from "node:path";
import type { WebpackConfiguration } from "@remotion/bundler";

// webpack isn't a direct dependency: borrow its Compiler type from the plugin slot of Remotion's config.
type PluginFn = Extract<NonNullable<WebpackConfiguration["plugins"]>[number], (...args: never[]) => void>;
type Compiler = Parameters<PluginFn>[0];
type HookCallback = (err?: Error | null, result?: unknown) => void;

/** What webpack hands afterResolve on the normal module factory (the parts we read). */
type NormalResolveData = {
  request?: string;
  contextInfo?: { issuer?: string };
  createData?: {
    resource?: string;
    resourceResolveData?: { path?: string | false };
    loaders?: { loader: string }[];
  };
};
/** …and on the context module factory (`import(dir + name)`, require.context). */
type ContextResolveData = { request?: string; resource?: string | string[]; contextInfo?: { issuer?: string } };

function isInside(p: string, dir: string) {
  return p === dir || p.startsWith(dir + path.sep);
}

/** Path without webpack's `?query` / `#fragment`. */
function cleanResource(resource: string) {
  return resource.replace(/[?#].*$/, "");
}

/**
 * May this resolved resource be bundled? `allowedDirs` are real (symlink-free)
 * absolute folders. Inline `data:` resources carry no file, so they pass; anything
 * that isn't an absolute path inside an allowed folder fails.
 */
export function isAllowedBundlePath(resource: string, allowedDirs: string[]) {
  if (/^data:/i.test(resource)) return true;
  const p = cleanResource(resource);
  if (!path.isAbsolute(p)) return false;
  return allowedDirs.some((dir) => isInside(p, dir));
}

function outsideError(what: string, resource: string, issuer: string | undefined, request: string | undefined) {
  const from = issuer ? ` (imported from ${issuer})` : "";
  return new Error(
    `Ajudan: can't bundle ${what} ${request && request !== resource ? `${request} → ` : ""}${resource}${from}: only files inside your folder and Ajudan's packages can be part of a video.`,
  );
}

/**
 * Webpack plugin that fails the build on any resource, context directory or loader
 * outside `allowedDirs`. Hooks the module factories rather than the resolver so that
 * assets (png, mp4, json), css, inline loaders and context modules are all covered.
 */
export function restrictBundlePaths(allowedDirs: string[]) {
  const dirs = allowedDirs.map((d) => fs.realpathSync(d));
  const check = (what: string, resource: string, data: { contextInfo?: { issuer?: string }; request?: string }) =>
    isAllowedBundlePath(resource, dirs) ? null : outsideError(what, cleanResource(resource), data.contextInfo?.issuer, data.request);
  return {
    apply(compiler: Compiler) {
      compiler.hooks.normalModuleFactory.tap("AjudanRestrictBundlePaths", (nmf) => {
        nmf.hooks.afterResolve.tapAsync("AjudanRestrictBundlePaths", ((data: NormalResolveData, cb: HookCallback) => {
          const cd = data.createData ?? {};
          const resource = (typeof cd.resourceResolveData?.path === "string" && cd.resourceResolveData.path) || cd.resource;
          if (resource !== undefined) {
            const err = check("the file", resource, data);
            if (err) return cb(err);
          }
          for (const l of cd.loaders ?? []) {
            const err = check("the loader", l.loader, data);
            if (err) return cb(err);
          }
          cb();
        }) as never);
      });
      compiler.hooks.contextModuleFactory.tap("AjudanRestrictBundlePaths", (cmf) => {
        cmf.hooks.afterResolve.tapAsync("AjudanRestrictBundlePaths", ((data: ContextResolveData, cb: HookCallback) => {
          const resources = Array.isArray(data.resource) ? data.resource : data.resource ? [data.resource] : [];
          for (const r of resources) {
            const err = check("the folder", r, data);
            if (err) return cb(err);
          }
          cb(null, data);
        }) as never);
      });
    },
  };
}

/**
 * The webpackOverride for a teammate render: resolve packages from Ajudan's
 * node_modules (the teammate's file lives outside this repo) and refuse anything
 * outside the teammate's folder or those packages.
 */
export function restrictedWebpackOverride(opts: { cwd: string; nodeModules: string }) {
  return (config: WebpackConfiguration): WebpackConfiguration => ({
    ...config,
    // symlinks: true makes a symlink inside the folder resolve to its real target, which the plugin then rejects.
    resolve: { ...config.resolve, symlinks: true, modules: [opts.nodeModules, "node_modules"] },
    resolveLoader: { ...config.resolveLoader, symlinks: true, modules: [opts.nodeModules, "node_modules"] },
    plugins: [...(config.plugins ?? []), restrictBundlePaths([opts.cwd, opts.nodeModules])],
  });
}

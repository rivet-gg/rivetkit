// tsup.config.ts
import { sentryEsbuildPlugin } from "@sentry/esbuild-plugin";
import { defineConfig } from "tsup";
import Macros from "unplugin-macros/esbuild";
var createRequireSnippet = `
import { createRequire as topLevelCreateRequire } from "node:module";
import { fileURLToPath as topLevelFileURLToPath, URL as topLevelURL } from "node:url";
const require = topLevelCreateRequire(import.meta.url);
const __filename = topLevelFileURLToPath(import.meta.url);
const __dirname = topLevelFileURLToPath(new topLevelURL(".", import.meta.url));
`;
var tsup_config_default = defineConfig({
  entry: ["src/mod.ts", "src/cli.ts"],
  platform: "node",
  bundle: true,
  format: "esm",
  clean: true,
  minify: true,
  shims: true,
  dts: true,
  sourcemap: true,
  external: [
    "yoga-wasm-web",
    "@sentry/profiling-node",
    "bundle-require",
    "esbuild"
  ],
  define: {
    "process.env.DEV": JSON.stringify(false),
    "process.env.NODE_ENV": JSON.stringify("production"),
    "process.env.SENTRY_DSN": JSON.stringify(process.env.SENTRY_DSN || "")
  },
  banner(ctx) {
    return { js: `#!/usr/bin/env node${createRequireSnippet}` };
  },
  esbuildOptions(options) {
    options.alias = {
      ...options.alias,
      "react-devtools-core": "./rdt-mock.js"
    };
    return options;
  },
  esbuildPlugins: [
    // @ts-ignore
    Macros(),
    sentryEsbuildPlugin({
      authToken: process.env.SENTRY_AUTH_TOKEN,
      org: "rivet-gaming",
      project: "actor-core-cli"
    }),
    {
      name: "remove-devtools-import",
      setup(build) {
        build.onEnd((result) => {
          result.outputFiles = result.outputFiles?.filter(
            (file) => !file.path.includes("dist/devtools-")
          );
        });
      }
    }
  ]
});
export {
  tsup_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidHN1cC5jb25maWcudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9faW5qZWN0ZWRfZmlsZW5hbWVfXyA9IFwiL1VzZXJzL25hdGhhbi9yaXZldC9hY3Rvci1jb3JlL3BhY2thZ2VzL2FjdG9yLWNvcmUtY2xpL3RzdXAuY29uZmlnLnRzXCI7Y29uc3QgX19pbmplY3RlZF9kaXJuYW1lX18gPSBcIi9Vc2Vycy9uYXRoYW4vcml2ZXQvYWN0b3ItY29yZS9wYWNrYWdlcy9hY3Rvci1jb3JlLWNsaVwiO2NvbnN0IF9faW5qZWN0ZWRfaW1wb3J0X21ldGFfdXJsX18gPSBcImZpbGU6Ly8vVXNlcnMvbmF0aGFuL3JpdmV0L2FjdG9yLWNvcmUvcGFja2FnZXMvYWN0b3ItY29yZS1jbGkvdHN1cC5jb25maWcudHNcIjtpbXBvcnQgeyBzZW50cnlFc2J1aWxkUGx1Z2luIH0gZnJvbSBcIkBzZW50cnkvZXNidWlsZC1wbHVnaW5cIjtcbmltcG9ydCB7IGRlZmluZUNvbmZpZyB9IGZyb20gXCJ0c3VwXCI7XG5pbXBvcnQgTWFjcm9zIGZyb20gXCJ1bnBsdWdpbi1tYWNyb3MvZXNidWlsZFwiO1xuXG5jb25zdCBjcmVhdGVSZXF1aXJlU25pcHBldCA9IGBcbmltcG9ydCB7IGNyZWF0ZVJlcXVpcmUgYXMgdG9wTGV2ZWxDcmVhdGVSZXF1aXJlIH0gZnJvbSBcIm5vZGU6bW9kdWxlXCI7XG5pbXBvcnQgeyBmaWxlVVJMVG9QYXRoIGFzIHRvcExldmVsRmlsZVVSTFRvUGF0aCwgVVJMIGFzIHRvcExldmVsVVJMIH0gZnJvbSBcIm5vZGU6dXJsXCI7XG5jb25zdCByZXF1aXJlID0gdG9wTGV2ZWxDcmVhdGVSZXF1aXJlKGltcG9ydC5tZXRhLnVybCk7XG5jb25zdCBfX2ZpbGVuYW1lID0gdG9wTGV2ZWxGaWxlVVJMVG9QYXRoKGltcG9ydC5tZXRhLnVybCk7XG5jb25zdCBfX2Rpcm5hbWUgPSB0b3BMZXZlbEZpbGVVUkxUb1BhdGgobmV3IHRvcExldmVsVVJMKFwiLlwiLCBpbXBvcnQubWV0YS51cmwpKTtcbmA7XG5cbmV4cG9ydCBkZWZhdWx0IGRlZmluZUNvbmZpZyh7XG5cdGVudHJ5OiBbXCJzcmMvbW9kLnRzXCIsIFwic3JjL2NsaS50c1wiXSxcblx0cGxhdGZvcm06IFwibm9kZVwiLFxuXHRidW5kbGU6IHRydWUsXG5cdGZvcm1hdDogXCJlc21cIixcblx0Y2xlYW46IHRydWUsXG5cdG1pbmlmeTogdHJ1ZSxcblx0c2hpbXM6IHRydWUsXG5cdGR0czogdHJ1ZSxcblx0c291cmNlbWFwOiB0cnVlLFxuXHRleHRlcm5hbDogW1xuXHRcdFwieW9nYS13YXNtLXdlYlwiLFxuXHRcdFwiQHNlbnRyeS9wcm9maWxpbmctbm9kZVwiLFxuXHRcdFwiYnVuZGxlLXJlcXVpcmVcIixcblx0XHRcImVzYnVpbGRcIixcblx0XSxcblx0ZGVmaW5lOiB7XG5cdFx0XCJwcm9jZXNzLmVudi5ERVZcIjogSlNPTi5zdHJpbmdpZnkoZmFsc2UpLFxuXHRcdFwicHJvY2Vzcy5lbnYuTk9ERV9FTlZcIjogSlNPTi5zdHJpbmdpZnkoXCJwcm9kdWN0aW9uXCIpLFxuXHRcdFwicHJvY2Vzcy5lbnYuU0VOVFJZX0RTTlwiOiBKU09OLnN0cmluZ2lmeShwcm9jZXNzLmVudi5TRU5UUllfRFNOIHx8IFwiXCIpLFxuXHR9LFxuXHRiYW5uZXIoY3R4KSB7XG5cdFx0cmV0dXJuIHsganM6IGAjIS91c3IvYmluL2VudiBub2RlJHtjcmVhdGVSZXF1aXJlU25pcHBldH1gIH07XG5cdH0sXG5cdGVzYnVpbGRPcHRpb25zKG9wdGlvbnMpIHtcblx0XHRvcHRpb25zLmFsaWFzID0ge1xuXHRcdFx0Li4ub3B0aW9ucy5hbGlhcyxcblx0XHRcdFwicmVhY3QtZGV2dG9vbHMtY29yZVwiOiBcIi4vcmR0LW1vY2suanNcIixcblx0XHR9O1xuXHRcdHJldHVybiBvcHRpb25zO1xuXHR9LFxuXHRlc2J1aWxkUGx1Z2luczogW1xuXHRcdC8vIEB0cy1pZ25vcmVcblx0XHRNYWNyb3MoKSxcblx0XHRzZW50cnlFc2J1aWxkUGx1Z2luKHtcblx0XHRcdGF1dGhUb2tlbjogcHJvY2Vzcy5lbnYuU0VOVFJZX0FVVEhfVE9LRU4sXG5cdFx0XHRvcmc6IFwicml2ZXQtZ2FtaW5nXCIsXG5cdFx0XHRwcm9qZWN0OiBcImFjdG9yLWNvcmUtY2xpXCIsXG5cdFx0fSksXG5cdFx0e1xuXHRcdFx0bmFtZTogXCJyZW1vdmUtZGV2dG9vbHMtaW1wb3J0XCIsXG5cdFx0XHRzZXR1cChidWlsZCkge1xuXHRcdFx0XHRidWlsZC5vbkVuZCgocmVzdWx0KSA9PiB7XG5cdFx0XHRcdFx0cmVzdWx0Lm91dHB1dEZpbGVzID0gcmVzdWx0Lm91dHB1dEZpbGVzPy5maWx0ZXIoXG5cdFx0XHRcdFx0XHQoZmlsZSkgPT4gIWZpbGUucGF0aC5pbmNsdWRlcyhcImRpc3QvZGV2dG9vbHMtXCIpLFxuXHRcdFx0XHRcdCk7XG5cdFx0XHRcdH0pO1xuXHRcdFx0fSxcblx0XHR9LFxuXHRdLFxufSk7XG4iXSwKICAibWFwcGluZ3MiOiAiO0FBQWdULFNBQVMsMkJBQTJCO0FBQ3BWLFNBQVMsb0JBQW9CO0FBQzdCLE9BQU8sWUFBWTtBQUVuQixJQUFNLHVCQUF1QjtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQVE3QixJQUFPLHNCQUFRLGFBQWE7QUFBQSxFQUMzQixPQUFPLENBQUMsY0FBYyxZQUFZO0FBQUEsRUFDbEMsVUFBVTtBQUFBLEVBQ1YsUUFBUTtBQUFBLEVBQ1IsUUFBUTtBQUFBLEVBQ1IsT0FBTztBQUFBLEVBQ1AsUUFBUTtBQUFBLEVBQ1IsT0FBTztBQUFBLEVBQ1AsS0FBSztBQUFBLEVBQ0wsV0FBVztBQUFBLEVBQ1gsVUFBVTtBQUFBLElBQ1Q7QUFBQSxJQUNBO0FBQUEsSUFDQTtBQUFBLElBQ0E7QUFBQSxFQUNEO0FBQUEsRUFDQSxRQUFRO0FBQUEsSUFDUCxtQkFBbUIsS0FBSyxVQUFVLEtBQUs7QUFBQSxJQUN2Qyx3QkFBd0IsS0FBSyxVQUFVLFlBQVk7QUFBQSxJQUNuRCwwQkFBMEIsS0FBSyxVQUFVLFFBQVEsSUFBSSxjQUFjLEVBQUU7QUFBQSxFQUN0RTtBQUFBLEVBQ0EsT0FBTyxLQUFLO0FBQ1gsV0FBTyxFQUFFLElBQUksc0JBQXNCLG9CQUFvQixHQUFHO0FBQUEsRUFDM0Q7QUFBQSxFQUNBLGVBQWUsU0FBUztBQUN2QixZQUFRLFFBQVE7QUFBQSxNQUNmLEdBQUcsUUFBUTtBQUFBLE1BQ1gsdUJBQXVCO0FBQUEsSUFDeEI7QUFDQSxXQUFPO0FBQUEsRUFDUjtBQUFBLEVBQ0EsZ0JBQWdCO0FBQUE7QUFBQSxJQUVmLE9BQU87QUFBQSxJQUNQLG9CQUFvQjtBQUFBLE1BQ25CLFdBQVcsUUFBUSxJQUFJO0FBQUEsTUFDdkIsS0FBSztBQUFBLE1BQ0wsU0FBUztBQUFBLElBQ1YsQ0FBQztBQUFBLElBQ0Q7QUFBQSxNQUNDLE1BQU07QUFBQSxNQUNOLE1BQU0sT0FBTztBQUNaLGNBQU0sTUFBTSxDQUFDLFdBQVc7QUFDdkIsaUJBQU8sY0FBYyxPQUFPLGFBQWE7QUFBQSxZQUN4QyxDQUFDLFNBQVMsQ0FBQyxLQUFLLEtBQUssU0FBUyxnQkFBZ0I7QUFBQSxVQUMvQztBQUFBLFFBQ0QsQ0FBQztBQUFBLE1BQ0Y7QUFBQSxJQUNEO0FBQUEsRUFDRDtBQUNELENBQUM7IiwKICAibmFtZXMiOiBbXQp9Cg==

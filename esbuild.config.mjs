import esbuild from "esbuild";
import process from "process";

const prod = process.argv[2] === "production";

const buildOptions = {
  entryPoints: ["src/main.ts"],
  bundle: true,
  platform: "node",
  external: ["obsidian", "electron", "@codemirror/*", "@lezer/*"],
  format: "cjs",
  target: "es2022",
  logLevel: "info",
  sourcemap: prod ? false : "inline",
  treeShaking: true,
  outfile: "main.js",
  minify: prod,
};

if (prod) {
  await esbuild.build(buildOptions);
} else {
  const ctx = await esbuild.context(buildOptions);
  await ctx.watch();
}

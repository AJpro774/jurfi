import fs from 'node:fs';
import path from 'node:path';
import postcss from 'postcss';
import config from '@jurfi/postcss-config';

fs.rmSync('dist', { recursive: true, force: true });

// Process every CSS file through the shared PostCSS config (custom-media + nesting),
// preserving the src/ layout (including tokens/). Other files are copied as-is.
async function walk(srcDir, outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const from = path.join(srcDir, entry.name);
    const to = path.join(outDir, entry.name);
    if (entry.isDirectory()) await walk(from, to);
    else if (entry.name.endsWith('.css')) {
      const result = await postcss(config.plugins).process(fs.readFileSync(from, 'utf8'), { from, to });
      fs.writeFileSync(to, result.css);
    } else fs.copyFileSync(from, to);
  }
}

await walk('src', 'dist');
console.log('ui: processed css to dist');

import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts', 'src/browser.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: true,
  // Optional peer dep, dynamically imported only in the browser entry.
  external: ['modern-screenshot'],
})

import { defineConfig } from 'vite';

// Bundles the multiplayer server (server/main.ts plus the shared simulation) into dist-server/main.js
export default defineConfig({
    publicDir: false,
    build: {
        ssr: 'server/main.ts',
        outDir: 'dist-server',
        emptyOutDir: true,
        target: 'node20',
        sourcemap: true,
        rollupOptions: {
            output: { entryFileNames: 'main.js', format: 'es' },
        },
    },
});

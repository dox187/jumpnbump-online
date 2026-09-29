import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
    build: {
        target: 'es2018',
    },
    server: {
        // `npm run dev:server` runs the multiplayer server on port 8080
        proxy: {
            '/ws': { target: 'ws://localhost:8080', ws: true },
        },
    },
    plugins: [
        preact({
            prerender: {
                enabled: true,
                renderTarget: '#app',
            },
        }),
        tailwindcss(),
    ],
});


import {defineConfig} from 'vite'
import vue from '@vitejs/plugin-vue'
import basicSsl from '@vitejs/plugin-basic-ssl'
import * as path from "node:path";

export default defineConfig(({command, mode}) => {
    const isProd = command === 'build' // true during `vite` dev server

    return {
        base: '/app/',
        // basicSsl generates a self-signed cert so the dev server runs over
        // HTTPS - needed to test camera access (getUserMedia) from a phone
        // on the local network, since browsers block it on plain HTTP.
        // You'll need to accept the browser's self-signed cert warning once.
        plugins: [vue(), ...(isProd ? [] : [basicSsl()])],
        resolve: {
            alias: {
                '@': path.resolve(__dirname, './src'), // 👈 this line is required
            },
        },
        // Vuetify 4 stacks overlays (a select menu inside a dialog) through a shared singleton. In dev, Vite can
        // serve some Vuetify modules pre-bundled and others as raw ESM, creating two copies of it, so menus
        // opened inside a dialog end up behind it. Pre-bundling the overlay modules together avoids that.
        optimizeDeps: {
            include: [
                'vuetify/components/VOverlay',
                'vuetify/components/VDialog',
                'vuetify/components/VMenu',
                'vuetify/components/VSelect',
                'vuetify/components/VTooltip',
            ],
        },
        build: {
            minify: 'esbuild', // esbuild handles minification in Vite
        },
        server: {
            host: true,
            proxy: isProd
                ? undefined
                : {
                    '/api/rest': {
                        target: 'http://localhost:3000',
                        changeOrigin: true,
                        secure: false,
                    },
                },
        },
    };
})

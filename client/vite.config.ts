
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

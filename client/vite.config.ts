
import {defineConfig} from 'vite'
import vue from '@vitejs/plugin-vue'
import * as path from "node:path";

export default defineConfig(({command, mode}) => {
    const isProd = command === 'build' // true during `vite` dev server

    return {
        base: '/app/',
        plugins: [vue()],
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

import {defineConfig} from "vite";
import vue from "@vitejs/plugin-vue";
import * as path from "node:path";

// The admin web app is served from the root of its own origin (e.g. https://adm.vaultisse.com), by the
// server's admin listener (ADMIN_PORT). In development Vite serves it on 5174 and forwards the API
// to the admin listener, so the browser sees one origin and the SameSite=Strict cookie just works.
export default defineConfig({
    base: "/",
    plugins: [vue()],
    resolve: {
        alias: {"@": path.resolve(__dirname, "./src")},
    },
    // Same Vuetify overlay pre-bundling reasoning as client/vite.config.ts.
    optimizeDeps: {
        include: [
            "vuetify/components/VOverlay",
            "vuetify/components/VDialog",
            "vuetify/components/VMenu",
            "vuetify/components/VSelect",
            "vuetify/components/VTooltip",
        ],
    },
    build: {
        minify: "esbuild",
        chunkSizeWarningLimit: 1200,
    },
    server: {
        host: true,
        port: 5174,
        proxy: {
            "/api/admin": {target: "http://localhost:3001", changeOrigin: false, secure: false},
        },
    },
});

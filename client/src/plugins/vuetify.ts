/**
 * Vuetify setup: registers every component/directive and defines the app's
 * two themes ("beige" - warm/light, all beige & terracotta, no blue -
 * "library" - dark/blue) plus the Material Design Icons set. The active
 * theme is switched at runtime by `applyTheme()` (see plugins/theme.ts),
 * driven by the logged-in user's saved preference (`users.theme`). These
 * color sets mirror the CSS custom properties in assets/styles/theme.scss.
 */
import 'vuetify/styles'
import '@/assets/styles/vuetify-compat.css'
import {aliases, mdi} from 'vuetify/iconsets/mdi'
import {createVuetify} from "vuetify/framework";
import * as components from "vuetify/components";
import * as directives from "vuetify/directives";

export default createVuetify({
    components,
    directives,
    theme: {
        defaultTheme: 'beige',
        themes: {
            beige: {
                dark: false,
                colors: {
                    background: '#f7f2ea',
                    surface: '#ffffff',
                    primary: '#c97b3d',
                    secondary: '#c97b3d',
                    accent: '#c97b3d',
                    error: '#d64545',
                    success: '#3f8f5f',
                }
            },
            library: {
                dark: true,
                colors: {
                    background: '#0a0e17',
                    surface: '#0d1420',
                    primary: '#1c7ff1',
                    secondary: '#78dcf6',
                    accent: '#1c7ff1',
                    error: '#ff5c5c',
                    success: '#4fce85',
                }
            },
        },
    },
    icons: {
        defaultSet: 'mdi',
        aliases,
        sets: {mdi},
    },
    defaults: {
        VCard: {
            rounded: 'lg',
        },
        VBtn: {
            rounded: 'lg',
        },
        VTextField: {
            rounded: 'lg',
        },
    },
})

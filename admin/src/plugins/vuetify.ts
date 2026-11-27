/**
 * Vuetify setup for the admin console: one dark and one light theme, amber accent, system fonts only
 * (the admin origin's CSP allows no third-party hosts).
 */
import "vuetify/styles";
import {aliases, mdi} from "vuetify/iconsets/mdi";
import {createVuetify} from "vuetify/framework";
import * as components from "vuetify/components";
import * as directives from "vuetify/directives";

export default createVuetify({
    components,
    directives,
    theme: {
        defaultTheme: "console-dark",
        themes: {
            "console-dark": {
                dark: true,
                colors: {
                    background: "#0e1319",
                    surface: "#161d26",
                    "surface-variant": "#222c38",
                    primary: "#f5b942",
                    secondary: "#6ea8fe",
                    error: "#ff6b6b",
                    warning: "#f5a742",
                    success: "#4cc38a",
                    info: "#6ea8fe",
                },
            },
            "console-light": {
                dark: false,
                colors: {
                    background: "#f3f4f6",
                    surface: "#ffffff",
                    primary: "#b7791f",
                    secondary: "#2f6fd6",
                    error: "#c53030",
                    warning: "#b7791f",
                    success: "#2f855a",
                    info: "#2f6fd6",
                },
            },
        },
    },
    icons: {defaultSet: "mdi", aliases, sets: {mdi}},
    defaults: {
        VCard: {rounded: "lg", variant: "flat"},
        VBtn: {rounded: "lg"},
        VTextField: {variant: "outlined", density: "comfortable", hideDetails: "auto"},
        VSelect: {variant: "outlined", density: "comfortable", hideDetails: "auto"},
        VTextarea: {variant: "outlined", density: "comfortable", hideDetails: "auto"},
        VTable: {density: "comfortable"},
    },
});

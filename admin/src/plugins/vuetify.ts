/**
 * Vuetify setup for the admin console. The two themes ("beige" - warm/light - and "library" - dark/blue)
 * carry exactly the same colors as the client app (client/src/plugins/vuetify.ts), so both apps look
 * like one product. Their CSS counterparts are the custom properties in assets/theme.css.
 */
import "vuetify/styles";
import "@/assets/vuetify-compat.css";
import {aliases, mdi} from "vuetify/iconsets/mdi";
import {createVuetify} from "vuetify/framework";
import * as components from "vuetify/components";
import * as directives from "vuetify/directives";

export default createVuetify({
    components,
    directives,
    theme: {
        defaultTheme: "beige",
        themes: {
            beige: {
                dark: false,
                colors: {
                    background: "#f7f2ea",
                    surface: "#ffffff",
                    primary: "#c97b3d",
                    secondary: "#c97b3d",
                    accent: "#c97b3d",
                    error: "#d64545",
                    success: "#3f8f5f",
                },
            },
            library: {
                dark: true,
                colors: {
                    background: "#0a0e17",
                    surface: "#0d1420",
                    primary: "#1c7ff1",
                    secondary: "#78dcf6",
                    accent: "#1c7ff1",
                    error: "#ff5c5c",
                    success: "#4fce85",
                },
            },
        },
    },
    icons: {defaultSet: "mdi", aliases, sets: {mdi}},
    defaults: {
        VCard: {rounded: "lg"},
        VBtn: {rounded: "lg", density: "comfortable"},
        VTable: {density: "compact"},
        // Outlined, compact inputs everywhere (about 40px tall).
        VTextField: {variant: "outlined", density: "compact", rounded: "lg", hideDetails: "auto"},
        VSelect: {variant: "outlined", density: "compact", rounded: "lg", hideDetails: "auto"},
        VTextarea: {variant: "outlined", density: "compact", rounded: "lg", hideDetails: "auto"},
        VSwitch: {density: "compact"},
        VCheckbox: {density: "compact"},
    },
});

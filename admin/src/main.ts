import {createApp} from "vue";
import "@mdi/font/css/materialdesignicons.css";
import App from "@/App.vue";
import router from "@/router";
import vuetify from "@/plugins/vuetify";
import "@/assets/theme.css";
import {hooks, setTheme, state} from "@/store";

setTheme(state.theme);

hooks.sessionExpired = () => {
    router.replace({name: "login"});
};

createApp(App).use(vuetify).use(router).mount("#app");

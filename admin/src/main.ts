import {createApp} from "vue";
import "@mdi/font/css/materialdesignicons.css";
import App from "@/App.vue";
import router from "@/router";
import vuetify from "@/plugins/vuetify";
import {hooks} from "@/store";

hooks.sessionExpired = () => {
    router.replace({name: "login"});
};

createApp(App).use(vuetify).use(router).mount("#app");

import { createRouter, createWebHistory } from "vue-router"
import HomeView from "@/views/HomeView.vue"
import StudioView from "@/views/StudioView.vue"

export default createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/", name: "home", component: HomeView },
    { path: "/studio/:draftId", name: "studio", component: StudioView }
  ],
  scrollBehavior: () => ({ top: 0 })
})

import { createApp } from 'vue'
import App from './App.vue'
import './global.css' // after App on purpose: the cascade order stays what it was when this lived in App.vue

createApp(App).mount('#app')

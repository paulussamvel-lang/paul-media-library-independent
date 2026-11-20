import { createApp } from 'vue';
import Workspace from './Workspace.vue';
import './library.css';

const root = document.querySelector('#paul-workspace');
const application = createApp(Workspace);
application.mount(root);

// エントリーポイント
import { App } from './app.js';
if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', () => App.init());
else App.init();

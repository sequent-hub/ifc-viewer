// Подключаем That Open Components из node_modules (нужна установка пакета)
import '@thatopen/components';

const app = document.querySelector('#app');
if (app) {
  app.innerHTML = `
    <to-app style="width:100%;height:100%">
      <to-toolbar slot="toolbar"></to-toolbar>
      <to-scene slot="main" id="scene"></to-scene>
      <to-panels-right slot="right">
        <to-panel-properties></to-panel-properties>
        <to-panel-sections></to-panel-sections>
        <to-panel-measure></to-panel-measure>
      </to-panels-right>
      <to-panels-left slot="left">
        <to-panel-loader></to-panel-loader>
      </to-panels-left>
    </to-app>
  `;
}



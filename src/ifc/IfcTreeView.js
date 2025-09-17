// Рендерит древовидную структуру IFC в контейнер

export class IfcTreeView {
  /**
   * @param {HTMLElement} container
   */
  constructor(container) {
    this.container = container;
  }

  /**
   * Рендерит дерево
   * @param {*} structure
   */
  render(structure) {
    if (!this.container) return;
    this.container.innerHTML = "";
    if (!structure) {
      this.container.innerHTML = `<div class="text-sm opacity-70 p-2">Нет данных IFC</div>`;
      return;
    }
    const rootEl = this._createNode(structure);
    this.container.appendChild(rootEl);
  }

  _createNode(node) {
    const el = document.createElement("div");
    el.className = "collapse collapse-arrow bg-base-100 mb-1 border border-base-300";
    const title = document.createElement("div");
    title.className = "collapse-title text-sm font-medium";
    title.textContent = `${node.type || 'IFC'} #${node.expressID || ''}`;
    const content = document.createElement("div");
    content.className = "collapse-content";

    el.appendChild(title);
    el.appendChild(content);

    if (Array.isArray(node.children) && node.children.length) {
      const list = document.createElement("div");
      list.className = "pl-2";
      node.children.forEach((ch) => list.appendChild(this._createNode(ch)));
      content.appendChild(list);
    } else {
      const stub = document.createElement("div");
      stub.className = "text-xs opacity-70";
      stub.textContent = "Пусто";
      content.appendChild(stub);
    }
    return el;
  }
}



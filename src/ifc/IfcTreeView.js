// Рендерит древовидную структуру IFC в контейнер

export class IfcTreeView {
  /**
   * @param {HTMLElement} container
   */
  constructor(container) {
    this.container = container;
    this._onSelect = null;
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
    // Рендерим только верхние 2 уровня, чтобы не подвесить браузер
    const rootEl = this._createNode(structure, 0, 2);
    this.container.appendChild(rootEl);
  }

  _createNode(node, depth = 0, maxDepth = Infinity) {
    const el = document.createElement("div");
    el.className = "collapse collapse-arrow bg-base-100 mb-1 border border-base-300";
    const title = document.createElement("div");
    title.className = "collapse-title text-sm font-medium cursor-pointer";
    title.textContent = `${node.type || 'IFC'} #${node.expressID || ''}`;
    const content = document.createElement("div");
    content.className = "collapse-content";

    el.appendChild(title);
    el.appendChild(content);

    // Клик по заголовку — выбор узла
    title.addEventListener("click", (e) => {
      e.stopPropagation();
      if (this._onSelect) this._onSelect(node);
    });

    if (depth < maxDepth && Array.isArray(node.children) && node.children.length) {
      const list = document.createElement("div");
      list.className = "pl-2";
      node.children.forEach((ch) => list.appendChild(this._createNode(ch, depth + 1, maxDepth)));
      content.appendChild(list);
    } else {
      const stub = document.createElement("div");
      stub.className = "text-xs opacity-70";
      stub.textContent = depth >= maxDepth ? "…" : "Пусто";
      content.appendChild(stub);
    }
    return el;
  }

  /**
   * Установить обработчик выбора узла
   * @param {(node:any)=>void} handler
   */
  onSelect(handler) {
    this._onSelect = handler;
  }

  // Временный тестовый рендер: плоский список свойств
  renderFlatProps(dump) {
    if (!this.container) return;
    const { total, count, limit, items } = dump || { total: 0, count: 0, limit: 0, items: [] };
    const wrap = document.createElement('div');
    wrap.className = 'p-2 text-xs space-y-2';
    const header = document.createElement('div');
    header.className = 'opacity-70';
    header.textContent = `Всего элементов: ${total}. Показано: ${count}/${limit}`;
    wrap.appendChild(header);
    items.forEach((it) => {
      const block = document.createElement('div');
      block.className = 'bg-base-100 border border-base-300 rounded p-2';
      const title = document.createElement('div');
      title.className = 'font-medium';
      title.textContent = `${it.type || 'ITEM'} #${it.id}`;
      const pre = document.createElement('pre');
      pre.className = 'whitespace-pre-wrap break-all max-h-60 overflow-auto mt-1';
      pre.textContent = JSON.stringify({ props: it.props, psets: it.psets }, null, 2);
      block.appendChild(title);
      block.appendChild(pre);
      wrap.appendChild(block);
    });
    this.container.innerHTML = '';
    this.container.appendChild(wrap);
  }
}



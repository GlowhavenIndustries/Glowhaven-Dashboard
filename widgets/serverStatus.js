import { Widget } from '../app.js';
import { fetchServerStatus } from '../dataSources.js';

export default class ServerStatusWidget extends Widget {
  renderContent() {
    const root = document.createElement('div');
    root.className = 'widget-content';
    this.stat = document.createElement('div');
    this.stat.className = 'widget-stat';
    this.list = document.createElement('ul');
    this.list.className = 'widget-list';
    this.footer = document.createElement('div');
    this.footer.className = 'widget-footer';
    root.append(this.stat, this.list, this.footer);
    this.updateData();
    this.every(() => this.updateData(), 15000);
    return root;
  }

  async updateData() {
    try {
      this.renderStatus(await fetchServerStatus());
    } catch {
      this.stat.textContent = 'Unavailable';
      this.list.replaceChildren();
      this.footer.textContent = 'Service monitor offline';
    }
  }

  renderStatus(data) {
    this.stat.textContent = data.uptime || 'Not configured';
    this.footer.textContent = 'Average response latency: ' + (data.latencyAvg ?? 0) + 'ms';
    this.list.replaceChildren(...(data.services?.length ? data.services.map((service) => {
      const li = document.createElement('li');
      const name = document.createElement('span');
      const badge = document.createElement('span');
      name.textContent = service.name;
      badge.className = `widget-badge ${service.status === 'operational' || service.status === 'healthy' ? 'positive' : ''}`;
      badge.textContent = service.status;
      li.append(name, badge);
      return li;
    }) : [Object.assign(document.createElement('li'), { className: 'empty-state', textContent: 'No service endpoints configured' })]));
  }
}

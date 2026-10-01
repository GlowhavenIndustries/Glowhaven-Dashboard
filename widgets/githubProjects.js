import { Widget } from '../app.js';
import { fetchGithubProjects } from '../dataSources.js';

export default class GithubProjectsWidget extends Widget {
  renderContent() {
    const root = document.createElement('div');
    root.className = 'widget-content';
    this.stat = document.createElement('div');
    this.stat.className = 'widget-stat';
    this.list = document.createElement('ul');
    this.list.className = 'widget-list';
    this.meta = document.createElement('div');
    this.meta.className = 'widget-footer';
    root.append(this.stat, this.list, this.meta);
    this.updateData();
    this.every(() => this.updateData(), 60000);
    return root;
  }

  async updateData() {
    try {
      this.renderProjects(await fetchGithubProjects());
    } catch {
      this.stat.textContent = 'Unavailable';
      this.list.replaceChildren();
      this.meta.textContent = 'GitHub Actions sync unavailable';
    }
  }

  renderProjects(data) {
    this.stat.textContent = data.summary || 'Not configured';
    this.meta.textContent = data.lastSync ? `Last synchronized: ${data.lastSync}` : '';
    this.list.replaceChildren(...(data.items?.length ? data.items.map((item) => {
      const li = document.createElement('li');
      const name = document.createElement('span');
      const badge = document.createElement('span');
      name.textContent = item.name;
      badge.className = `widget-badge ${item.status === 'success' || item.status === 'passing' ? 'positive' : ''}`;
      badge.textContent = item.status;
      li.append(name, badge);
      return li;
    }) : [Object.assign(document.createElement('li'), { className: 'empty-state', textContent: 'No pipeline repositories configured' })]));
  }
}

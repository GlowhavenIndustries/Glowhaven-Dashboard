import { Widget } from '../app.js';
import {
  fetchActivity,
  fetchAutomations,
  fetchBusinessKpis,
  fetchIncidents,
  executeAutomation,
} from '../dataSources.js';

function listItem(label, meta = '') {
  const li = document.createElement('li');
  const left = document.createElement('span');
  const right = document.createElement('span');
  left.textContent = label;
  right.className = 'widget-badge';
  right.textContent = meta;
  li.append(left, right);
  return li;
}

function emptyState(text) {
  const li = document.createElement('li');
  li.className = 'empty-state';
  li.textContent = text;
  return li;
}

export class KpiWidget extends Widget {
  renderContent() {
    const root = document.createElement('div');
    root.className = 'widget-content';
    this.list = document.createElement('ul');
    this.list.className = 'widget-list';
    root.append(this.list);
    this.updateData();
    this.every(() => this.updateData(), this.dashboard.config.dataSources.kpi?.refreshMs || 60000);
    return root;
  }

  async updateData() {
    try {
      const data = await fetchBusinessKpis(this.dashboard.config.dataSources.kpi || {});
      this.list.replaceChildren();
      if (!data.metrics.length) {
        this.list.append(emptyState('Connect a KPI endpoint or add metrics to configuration.'));
        return;
      }
      data.metrics.forEach((metric) => {
        const meta = metric.change || metric.trend;
        this.list.append(listItem(`${metric.label}: ${metric.value}`, meta));
      });
    } catch {
      this.list.replaceChildren(emptyState('KPI integration unavailable.'));
    }
  }
}

export class IncidentWidget extends Widget {
  renderContent() {
    const root = document.createElement('div');
    root.className = 'widget-content';
    this.stat = document.createElement('div');
    this.stat.className = 'widget-stat';
    this.list = document.createElement('ul');
    this.list.className = 'widget-list';
    root.append(this.stat, this.list);
    this.updateData();
    this.every(() => this.updateData(), this.dashboard.config.dataSources.incidents?.refreshMs || 30000);
    return root;
  }

  async updateData() {
    try {
      const { incidents } = await fetchIncidents(this.dashboard.config.dataSources.incidents || {});
      const open = incidents.filter((incident) => !['closed', 'resolved'].includes(incident.status.toLowerCase()));
      this.stat.textContent = `${open.length} open`;
      this.list.replaceChildren();
      if (!open.length) this.list.append(emptyState('No open incidents.'));
      open.slice(0, 6).forEach((incident) => {
        this.list.append(listItem(incident.title, incident.severity));
      });
    } catch {
      this.stat.textContent = 'Unavailable';
      this.list.replaceChildren(emptyState('Incident integration unavailable.'));
    }
  }
}

export class AutomationWidget extends Widget {
  renderContent() {
    const root = document.createElement('div');
    root.className = 'widget-content';
    this.stat = document.createElement('div');
    this.stat.className = 'widget-stat';
    this.list = document.createElement('ul');
    this.list.className = 'widget-list';
    root.append(this.stat, this.list);
    this.updateData();
    this.every(() => this.updateData(), this.dashboard.config.dataSources.automations?.refreshMs || 30000);
    return root;
  }

  async updateData() {
    try {
      const { automations } = await fetchAutomations(this.dashboard.config.dataSources.automations || {});
      this.stat.textContent = `${automations.length} jobs`;
      this.list.replaceChildren();
      if (!automations.length) this.list.append(emptyState('No automations configured.'));
      automations.slice(0, 6).forEach((job) => {
        const li = listItem(job.name, job.status);
        if (this.dashboard.config.dataSources.automations?.endpoint) {
          const button = document.createElement('button');
          button.className = 'mini-button';
          button.type = 'button';
          button.textContent = 'Run';
          button.addEventListener('click', async (event) => {
            event.stopPropagation();
            button.disabled = true;
            button.textContent = '...';
            try {
              await executeAutomation(this.dashboard.config.dataSources.automations, job);
              button.textContent = 'Queued';
            } catch {
              button.textContent = 'Failed';
            } finally {
              setTimeout(() => { button.disabled = false; button.textContent = 'Run'; }, 1800);
            }
          });
          li.append(button);
        }
        this.list.append(li);
      });
    } catch {
      this.stat.textContent = 'Unavailable';
      this.list.replaceChildren(emptyState('Automation integration unavailable.'));
    }
  }
}

export class ActivityWidget extends Widget {
  renderContent() {
    const root = document.createElement('div');
    root.className = 'widget-content';
    this.list = document.createElement('ul');
    this.list.className = 'widget-list';
    root.append(this.list);
    this.updateData();
    this.every(() => this.updateData(), this.dashboard.config.dataSources.activity?.refreshMs || 30000);
    return root;
  }

  async updateData() {
    try {
      const { items } = await fetchActivity(this.dashboard.config.dataSources.activity || {});
      this.list.replaceChildren();
      if (!items.length) this.list.append(emptyState('No activity available.'));
      items.slice(0, 8).forEach((entry) => {
        const label = entry.detail ? `${entry.title} · ${entry.detail}` : entry.title;
        this.list.append(listItem(label, entry.time ? new Date(entry.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''));
      });
    } catch {
      this.list.replaceChildren(emptyState('Activity integration unavailable.'));
    }
  }
}

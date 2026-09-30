import { Widget } from '../app.js';
import {
  fetchActivity,
  fetchAutomations,
  fetchBusinessKpis,
  fetchIncidents,
  executeAutomation,
  executeIncidentAction,
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
    this.every(() => this.updateData(), 60000);
    return root;
  }

  async updateData() {
    try {
      const data = await fetchBusinessKpis();
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
    this.every(() => this.updateData(), 30000);
    return root;
  }

  async updateData() {
    try {
      const { incidents } = await fetchIncidents();
      const open = incidents.filter((incident) => !['closed', 'resolved'].includes(String(incident.status || '').toLowerCase()));
      this.stat.textContent = `${open.length} open`;
      this.list.replaceChildren();
      if (!open.length) this.list.append(emptyState('No open incidents.'));
      open.slice(0, 6).forEach((incident) => {
        const li = listItem(incident.title, incident.severity || 'open');
        const ackBtn = document.createElement('button');
        ackBtn.className = 'mini-button';
        ackBtn.type = 'button';
        ackBtn.textContent = 'Ack';
        ackBtn.title = 'Acknowledge Incident';
        ackBtn.addEventListener('click', async (event) => {
          event.stopPropagation();
          ackBtn.disabled = true;
          ackBtn.textContent = '...';
          try {
            await executeIncidentAction(incident.id || incident.title, 'acknowledge');
            ackBtn.textContent = 'Acked';
          } catch {
            ackBtn.textContent = 'Err';
          } finally {
            setTimeout(() => { ackBtn.disabled = false; ackBtn.textContent = 'Ack'; }, 2000);
          }
        });
        li.append(ackBtn);
        this.list.append(li);
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
    this.every(() => this.updateData(), 30000);
    return root;
  }

  async updateData() {
    try {
      const { automations } = await fetchAutomations();
      this.stat.textContent = `${automations.length} jobs`;
      this.list.replaceChildren();
      if (!automations.length) this.list.append(emptyState('No automations configured.'));
      automations.slice(0, 6).forEach((job) => {
        const li = listItem(job.name, job.status || 'ready');
        const button = document.createElement('button');
        button.className = 'mini-button';
        button.type = 'button';
        button.textContent = 'Run';
        button.addEventListener('click', async (event) => {
          event.stopPropagation();
          button.disabled = true;
          button.textContent = '...';
          try {
            await executeAutomation(job);
            button.textContent = 'Queued';
          } catch {
            button.textContent = 'Failed';
          } finally {
            setTimeout(() => { button.disabled = false; button.textContent = 'Run'; }, 1800);
          }
        });
        li.append(button);
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
    this.every(() => this.updateData(), 30000);
    return root;
  }

  async updateData() {
    try {
      const { items } = await fetchActivity();
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

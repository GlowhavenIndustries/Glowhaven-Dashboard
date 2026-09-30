import { Widget } from '../app.js';

function item(text, meta) {
  const li = document.createElement('li');
  const a = document.createElement('span');
  const b = document.createElement('span');
  a.textContent = text; b.className = 'widget-badge'; b.textContent = meta;
  li.append(a, b); return li;
}

export class KpiWidget extends Widget {
  renderContent() {
    const root=document.createElement('div'); root.className='widget-content';
    this.stat=document.createElement('div'); this.stat.className='widget-stat'; this.stat.textContent='Ready';
    const note=document.createElement('p'); note.className='muted'; note.textContent='Connect a business adapter to show revenue, tickets, orders, or other KPIs.';
    root.append(this.stat,note); return root;
  }
}

export class IncidentWidget extends Widget {
  renderContent() {
    const root=document.createElement('div'); root.className='widget-content';
    this.stat=document.createElement('div'); this.stat.className='widget-stat'; this.stat.textContent='0 open';
    this.list=document.createElement('ul'); this.list.className='widget-list';
    this.list.append(item('No incidents configured','Ready'));
    root.append(this.stat,this.list); return root;
  }
}

export class AutomationWidget extends Widget {
  renderContent() {
    const root=document.createElement('div'); root.className='widget-content';
    this.stat=document.createElement('div'); this.stat.className='widget-stat'; this.stat.textContent='0 queued';
    this.list=document.createElement('ul'); this.list.className='widget-list';
    this.list.append(item('Automation adapters ready','Local'));
    root.append(this.stat,this.list); return root;
  }
}

export class ActivityWidget extends Widget {
  renderContent() {
    const root=document.createElement('div'); root.className='widget-content';
    this.list=document.createElement('ul'); this.list.className='widget-list';
    this.list.append(item('Workspace initialized','Now'),item('Modules loaded','System'));
    root.append(this.list); return root;
  }
}

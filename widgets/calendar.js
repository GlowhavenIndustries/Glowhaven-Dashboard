import { Widget } from '../app.js';
import { fetchCalendarEvents } from '../dataSources.js';

export default class CalendarWidget extends Widget {
  renderContent() {
    const root = document.createElement('div');
    root.className = 'widget-content';
    this.date = document.createElement('div');
    this.date.className = 'widget-stat';
    this.list = document.createElement('ul');
    this.list.className = 'widget-list';
    root.append(this.date, this.list);
    this.updateData();
    this.every(() => this.updateData(), 300000);
    return root;
  }

  async updateData() {
    this.date.textContent = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
    try {
      const events = await fetchCalendarEvents();
      this.list.replaceChildren(...(events.length ? events.map((event) => {
        const li = document.createElement('li');
        const titleSpan = document.createElement('span');
        titleSpan.textContent = event.title;
        const timeBadge = document.createElement('span');
        timeBadge.className = 'widget-badge';
        timeBadge.textContent = event.time ? new Date(event.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'All Day';
        li.append(titleSpan, timeBadge);
        return li;
      }) : [Object.assign(document.createElement('li'), { className: 'empty-state', textContent: 'No upcoming scheduled events' })]));
    } catch {
      this.list.replaceChildren(Object.assign(document.createElement('li'), { className: 'empty-state', textContent: 'Calendar integration unavailable' }));
    }
  }
}

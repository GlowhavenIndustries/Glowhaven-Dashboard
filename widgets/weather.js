import { Widget } from '../app.js';
import { fetchWeather } from '../dataSources.js';

export default class WeatherWidget extends Widget {
  renderContent() {
    const root = document.createElement('div');
    root.className = 'widget-content';
    this.location = document.createElement('div');
    this.location.className = 'eyebrow';
    this.temp = document.createElement('div');
    this.temp.className = 'widget-stat';
    this.conditions = document.createElement('p');
    this.conditions.className = 'muted';
    const grid = document.createElement('div');
    grid.className = 'weather-grid';
    this.fields = {};
    [['wind', 'Wind Vector'], ['aqi', 'Air Quality'], ['uv', 'UV Index']].forEach(([key, label]) => {
      const box = document.createElement('div');
      const p = document.createElement('p');
      p.className = 'label';
      p.textContent = label;
      const strong = document.createElement('strong');
      strong.textContent = 'N/A';
      box.append(p, strong);
      this.fields[key] = strong;
      grid.append(box);
    });
    root.append(this.location, this.temp, this.conditions, grid);
    this.updateData();
    this.every(() => this.updateData(), 60000);
    return root;
  }

  async updateData() {
    try {
      const data = await fetchWeather();
      this.location.textContent = data.city || 'Local Location';
      this.temp.textContent = data.temp || 'N/A';
      this.conditions.textContent = data.conditions || 'Weather data unavailable';
      this.fields.wind.textContent = data.wind || 'N/A';
      this.fields.aqi.textContent = data.aqi || 'N/A';
      this.fields.uv.textContent = data.uv || 'N/A';
    } catch {
      this.temp.textContent = 'N/A';
      this.conditions.textContent = 'Weather telemetry offline';
    }
  }
}

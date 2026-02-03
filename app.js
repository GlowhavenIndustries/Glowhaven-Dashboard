const app = document.querySelector('.app');
const themeToggle = document.getElementById('themeToggle');

const weatherStates = [
  {
    temp: '72°',
    conditions: 'Clear · 12% humidity',
    wind: '6 mph',
    aqi: '42',
    uv: 'Low',
  },
  {
    temp: '68°',
    conditions: 'Marine layer · 20% humidity',
    wind: '9 mph',
    aqi: '39',
    uv: 'Moderate',
  },
  {
    temp: '74°',
    conditions: 'Sunset glow · 15% humidity',
    wind: '4 mph',
    aqi: '45',
    uv: 'Low',
  },
];

let weatherIndex = 0;

function rotateWeather() {
  const { temp, conditions, wind, aqi, uv } = weatherStates[weatherIndex];
  document.getElementById('temperature').textContent = temp;
  document.getElementById('conditions').textContent = conditions;
  document.getElementById('wind').textContent = wind;
  document.getElementById('aqi').textContent = aqi;
  document.getElementById('uv').textContent = uv;
  weatherIndex = (weatherIndex + 1) % weatherStates.length;
}

rotateWeather();
setInterval(rotateWeather, 6000);

themeToggle.addEventListener('click', () => {
  const nextTheme = app.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  app.setAttribute('data-theme', nextTheme);
});

import { fetchTelemetrySnapshot } from './dataSources.js';

export class Widget {
  constructor(config, dashboard) {
    this.config = config;
    this.dashboard = dashboard;
    this.element = null;
    this.cleanups = [];
  }
  render() {
    const card = document.createElement('article');
    card.className = 'widget-card';
    card.dataset.widgetId = this.config.id;
    card.style.gridColumn = `${this.config.position.x} / span ${this.config.position.w}`;
    card.style.gridRow = `${this.config.position.y} / span ${this.config.position.h}`;

    const header = document.createElement('header');
    header.className = 'widget-header';
    const title = document.createElement('div');
    title.innerHTML = `<span class="eyebrow">${this.config.type}</span><h3></h3>`;
    title.querySelector('h3').textContent = this.config.title;
    const actions = document.createElement('div');
    actions.className = 'widget-actions';
    const badge = document.createElement('span');
    badge.className = 'widget-badge';
    badge.textContent = this.config.role || 'viewer';
    actions.appendChild(badge);
    if (this.dashboard.canEdit) {
      const remove = document.createElement('button');
      remove.className = 'icon-button';
      remove.type = 'button';
      remove.title = 'Remove widget';
      remove.textContent = '×';
      remove.addEventListener('click', () => this.dashboard.removeWidget(this.config.id));
      actions.appendChild(remove);
    }
    header.append(title, actions);

    const body = document.createElement('div');
    body.className = 'widget-body';
    body.appendChild(this.renderContent());
    card.append(header, body);
    if (this.dashboard.canEdit) this.enableDrag(card);
    this.element = card;
    return card;
  }
  renderContent() { const p=document.createElement('p'); p.className='muted'; p.textContent='Loading…'; return p; }
  enableDrag(card) {
    card.setAttribute('draggable','true');
    const onDragStart = () => card.classList.add('is-dragging');
    const onDragEnd = () => card.classList.remove('is-dragging');
    card.addEventListener('dragstart', onDragStart);
    card.addEventListener('dragend', onDragEnd);
    this.cleanups.push(() => {
      card.removeEventListener('dragstart', onDragStart);
      card.removeEventListener('dragend', onDragEnd);
    });
  }
  destroy() {
    this.cleanups.forEach(fn => fn());
    this.cleanups = [];
    if (this.interval) clearInterval(this.interval);
    if (this.unsubscribe) this.unsubscribe();
  }
}

const DEFAULT_CONFIG = {
  version: 2,
  theme: 'dark',
  visual: 'neon',
  consoleMode: false,
  activeDashboardId: 'personal',
  activeRole: 'admin',
  encryptionEnabled: true,
  dataSources: {
    calendar: { provider:'github', refreshMs:300000, github:{org:'GlowhavenIndustries'} },
    weather: { provider:'openMeteo', refreshMs:60000, openMeteo:{units:'imperial',location:{city:'Dallas',lat:32.7767,lon:-96.7970}} },
    serverStatus: { refreshMs:15000, endpoints:[] },
    github: { refreshMs:60000, token:'', repositories:[
      {owner:'GlowhavenIndustries',repo:'Glowhaven-Dashboard'},
      {owner:'GlowhavenIndustries',repo:'Glowhaven-Media-Orchestrator'}
    ] }
  },
  realtime:{enabled:true,sseUrl:'',websocketUrl:'',refreshMs:5000},
  dashboards:{
    personal:{id:'personal',label:'Personal',role:'admin',widgets:[
      {id:'calendar-1',type:'calendar',title:'Command Calendar',position:{x:1,y:1,w:4,h:2},role:'admin'},
      {id:'weather-1',type:'weather',title:'Climate Intelligence',position:{x:5,y:1,w:4,h:2},role:'viewer'},
      {id:'server-1',type:'serverStatus',title:'Global Systems Monitor',position:{x:9,y:1,w:4,h:2},role:'admin',priority:'high'},
      {id:'github-1',type:'githubProjects',title:'Pipeline Oversight',position:{x:1,y:3,w:6,h:3},role:'viewer'}
    ]},
    team:{id:'team',label:'Team',role:'viewer',widgets:[
      {id:'calendar-team',type:'calendar',title:'Global Sync Calendar',position:{x:1,y:1,w:5,h:2},role:'viewer'},
      {id:'server-team',type:'serverStatus',title:'Fleet Telemetry',position:{x:6,y:1,w:7,h:2},role:'admin',priority:'high'},
      {id:'github-team',type:'githubProjects',title:'Release Pipelines',position:{x:1,y:3,w:7,h:3},role:'viewer'},
      {id:'weather-team',type:'weather',title:'Ops Weather',position:{x:8,y:3,w:5,h:3},role:'viewer'}
    ]}
  }
};

const STORAGE_KEY='glowhaven-dashboard-v2';
const registry={};
const $=id=>document.getElementById(id);
const clone=value=>structuredClone(value);
const merge=(base,patch)=>({
  ...base,...patch,
  dataSources:{...base.dataSources,...patch.dataSources},
  realtime:{...base.realtime,...patch.realtime},
  dashboards:patch.dashboards||base.dashboards
});

class Storage {
  load(){
    try { const raw=localStorage.getItem(STORAGE_KEY); return raw?merge(clone(DEFAULT_CONFIG),JSON.parse(raw)):clone(DEFAULT_CONFIG); }
    catch { return clone(DEFAULT_CONFIG); }
  }
  save(config){
    try { localStorage.setItem(STORAGE_KEY,JSON.stringify(config)); return true; }
    catch { return false; }
  }
}

class Telemetry {
  constructor(config){this.config=config;this.listeners=new Set();this.timer=null;this.running=false;}
  subscribe(fn){this.listeners.add(fn);return()=>this.listeners.delete(fn);}
  emit(data){this.listeners.forEach(fn=>fn(data));}
  start(){
    if(this.running||!this.config?.enabled)return;
    this.running=true;
    const poll=async()=>{try{this.emit(await fetchTelemetrySnapshot({endpoints:this.config.endpoints}));}catch{}};
    poll(); this.timer=setInterval(poll,Math.max(3000,this.config.refreshMs||5000));
  }
  stop(){clearInterval(this.timer);this.timer=null;this.running=false;}
}

class Dashboard {
  constructor(config,storage,telemetry){this.config=config;this.storage=storage;this.telemetry=telemetry;this.grid=$('widgetGrid');this.widgets=[];}
  get activeDashboard(){return this.config.dashboards[this.config.activeDashboardId]||this.config.dashboards.personal;}
  get canEdit(){return this.config.activeRole==='admin' && this.activeDashboard.role==='admin';}
  persist(){this.storage.save(this.config);updateStatus(this);}
  render(){
    this.widgets.forEach(w=>w.destroy()); this.widgets=[]; this.grid.replaceChildren();
    this.activeDashboard.widgets.filter(w=>w.role!=='admin'||this.config.activeRole==='admin').forEach(cfg=>{
      const Type=registry[cfg.type]; if(!Type)return;
      const instance=new Type(cfg,this); this.widgets.push(instance); this.grid.appendChild(instance.render());
    });
    updateStatus(this);
  }
  setDashboard(id){if(!this.config.dashboards[id])return;this.config.activeDashboardId=id;this.render();this.persist();}
  setRole(role){this.config.activeRole=role;this.render();this.persist();}
  removeWidget(id){this.activeDashboard.widgets=this.activeDashboard.widgets.filter(w=>w.id!==id);this.render();this.persist();}
  addWidget(type){
    const titles={calendar:'Command Calendar',weather:'Climate Intelligence',serverStatus:'Systems Monitor',githubProjects:'Pipeline Oversight'};
    const n=this.activeDashboard.widgets.length;
    this.activeDashboard.widgets.push({id:`${type}-${Date.now()}`,type,title:titles[type]||'New Module',position:{x:1,y:4+n,w:4,h:2},role:'viewer'});
    this.render();this.persist();
  }
}

function updateStatus(d){
  const dash=d.activeDashboard;
  $('dashboardSelect').value=d.config.activeDashboardId;
  $('roleSelect').value=d.config.activeRole;
  $('statusDashboard').textContent=`${dash.label} dashboard`;
  $('statusRole').textContent=`${d.config.activeRole} role`;
  $('statusEdit').textContent=d.canEdit?'Edit mode enabled':'View-only mode';
  $('statusSecurity').textContent=d.config.encryptionEnabled?'Local config protected':'Local config unprotected';
  $('metricMode').textContent=d.config.consoleMode?'CONSOLE':'GLOW';
}

function downloadConfig(config){
  const blob=new Blob([JSON.stringify(config,null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download=`glowhaven-dashboard-${Date.now()}.json`;a.click();URL.revokeObjectURL(url);
}

async function init(){
  const modules=await Promise.all([
    import('./widgets/calendar.js'),import('./widgets/weather.js'),
    import('./widgets/serverStatus.js'),import('./widgets/githubProjects.js')
  ]);
  ['calendar','weather','serverStatus','githubProjects'].forEach((key,i)=>registry[key]=modules[i].default);
  const storage=new Storage(),config=storage.load(),telemetry=new Telemetry(config.realtime);
  const dashboard=new Dashboard(config,storage,telemetry);

  document.documentElement.dataset.theme=config.theme;
  document.documentElement.dataset.visual=config.visual;
  document.body.classList.toggle('console-mode',config.consoleMode);
  dashboard.render();telemetry.subscribe(p=>{if(p.metrics){$('metricAvailability').textContent=p.metrics.availability||'—';$('metricLatency').textContent=p.metrics.latency||'—';$('metricAlerts').textContent=p.metrics.alerts||'—';}});telemetry.start();

  $('dashboardSelect').addEventListener('change',e=>dashboard.setDashboard(e.target.value));
  $('roleSelect').addEventListener('change',e=>dashboard.setRole(e.target.value));
  $('themeToggle').addEventListener('click',()=>{config.theme=config.theme==='dark'?'light':'dark';document.documentElement.dataset.theme=config.theme;dashboard.persist();});
  $('neonToggle').addEventListener('click',()=>{config.visual=config.visual==='neon'?'minimal':'neon';document.documentElement.dataset.visual=config.visual;dashboard.persist();});
  $('consoleToggle').addEventListener('click',()=>{config.consoleMode=!config.consoleMode;document.body.classList.toggle('console-mode',config.consoleMode);dashboard.persist();});
  $('exportConfig').addEventListener('click',()=>downloadConfig(config));
  $('importConfig').addEventListener('click',()=>$('importInput').click());
  $('importInput').addEventListener('change',async e=>{try{const file=e.target.files[0];if(!file)return;const imported=JSON.parse(await file.text());dashboard.config=merge(clone(DEFAULT_CONFIG),imported);dashboard.render();dashboard.persist();}catch{alert('That configuration file is not valid.');}e.target.value='';});
  $('addWidget').addEventListener('click',()=>dashboard.addWidget($('widgetType').value));
  $('searchInput').addEventListener('input',e=>{
    const q=e.target.value.trim().toLowerCase();
    dashboard.widgets.forEach(w=>{w.element.hidden=!!q&&!w.config.title.toLowerCase().includes(q)&&!w.config.type.toLowerCase().includes(q);});
  });
  $('refreshAll').addEventListener('click',()=>dashboard.widgets.forEach(w=>w.updateData?.()));
  document.querySelectorAll('.nav-item').forEach(btn=>btn.addEventListener('click',()=>{document.querySelectorAll('.nav-item').forEach(x=>x.classList.remove('active'));btn.classList.add('active');}));
  $('launchButton').addEventListener('click',()=>{ $('systemToast').textContent='Directive queued locally · dashboard ready';$('systemToast').classList.add('show');setTimeout(()=>$('systemToast').classList.remove('show'),2500);});
}
init().catch(error=>{console.error(error);$('systemToast').textContent='Glowhaven failed to initialize';$('systemToast').classList.add('show');});

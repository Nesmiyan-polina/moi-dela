import { firebaseConfig } from './firebase-config.js';

const $ = (selector) => document.querySelector(selector);
const today = () => new Date().toLocaleDateString('sv-SE');
const defaultProjects=[{id:'vc',name:'ВЦ'},{id:'eco',name:'Эко'},{id:'personal',name:'Личное'}];
const state = { tasks: [], projects:[...defaultProjects], view: 'today', project: '', calendarMonth:todayMonth(), calendarDate:today(), user: null, cloud: false, adapter: null, unsubscribe: null, projectsUnsubscribe:null, detailUnsubscribers: [], settingsUnsubscribe: null, openTaskId: '', subtasks: [], comments: [], capacityMin: 240, authMode: 'signup', snapshotMetadata: null };
function todayMonth() { return new Date().toLocaleDateString('sv-SE').slice(0,7); }
const legacyProjectIds={ВЦ:'vc',Эко:'eco',Личное:'personal'};
const projectId = value => legacyProjectIds[value]||value||'';
const projectName = value => state.projects.find(item=>item.id===projectId(value))?.name||value||'';
const dateLabel = (value) => value ? new Date(`${value}T12:00:00`).toLocaleDateString('ru-RU', {day:'numeric', month:'short'}) : '';
const taskDate = (task) => task.dueDate || '';
const isOverdue = (task) => !task.done && taskDate(task) && taskDate(task) < today();
const category = (task) => !taskDate(task) ? 'nodate' : taskDate(task) <= today() ? 'today' : 'upcoming';
const priorityRank = {high:0,medium:1,low:2,'':3};
const sortTasks = (a,b) => Number(a.done)-Number(b.done) || (priorityRank[a.priority||'']-priorityRank[b.priority||'']) || (a.dueDate || '9999').localeCompare(b.dueDate || '9999') || (a.createdAt || '').localeCompare(b.createdAt || '');
const estimateLabel = minutes => minutes >= 60 ? `${Math.floor(minutes/60)} ч ${minutes%60?`${minutes%60} мин`:''}`.trim() : `${minutes} мин`;
const taskCountLabel = count => `${count} ${count%100>=11&&count%100<=14?'дел':count%10===1?'дело':count%10>=2&&count%10<=4?'дела':'дел'}`;
const taskDefaults = {priority:'',estimateMin:0,repeat:'',remindAt:'',plannedDate:'',repeatAnchor:0};
const normalizeTask = task => ({...taskDefaults,...task});
const detailKey = name => `my-${name}-preview-v1`;

function nextRepeatDate(task) {
  const current=new Date(`${task.dueDate}T12:00:00`);
  const anchor=task.repeatAnchor || current.getDate();
  do {
    if (task.repeat==='daily') current.setDate(current.getDate()+1);
    else if (task.repeat==='weekly') current.setDate(current.getDate()+7);
    else {
      const year=current.getFullYear(), month=current.getMonth()+1;
      current.setFullYear(year,month,Math.min(anchor,new Date(year,month+1,0).getDate()));
    }
  } while (current.toLocaleDateString('sv-SE')<=today());
  return current.toLocaleDateString('sv-SE');
}

function repeatPatch(task) {
  const dueDate=nextRepeatDate(task);
  let remindAt='';
  if (task.remindAt) {
    const oldReminder=new Date(task.remindAt);
    const oldDue=new Date(`${task.dueDate}T12:00:00`);
    const offset=Math.round((new Date(oldReminder.getFullYear(),oldReminder.getMonth(),oldReminder.getDate())-new Date(oldDue.getFullYear(),oldDue.getMonth(),oldDue.getDate()))/86400000);
    const nextReminder=new Date(`${dueDate}T12:00:00`);
    nextReminder.setDate(nextReminder.getDate()+offset);
    nextReminder.setHours(oldReminder.getHours(),oldReminder.getMinutes(),0,0);
    remindAt=nextReminder.toISOString();
  }
  return {dueDate,remindAt,done:false,plannedDate:''};
}

function localAdapter() {
  const key = 'my-tasks-preview-v1';
  const listeners = {subtasks:new Map(),comments:new Map(),settings:null,projects:null};
  const read = () => { try { return JSON.parse(localStorage.getItem(key) || '[]'); } catch { return []; } };
  const write = tasks => { localStorage.setItem(key, JSON.stringify(tasks)); state.tasks = tasks; render(); };
  const readDetails = kind => { try { return JSON.parse(localStorage.getItem(detailKey(kind)) || '{}'); } catch { return {}; } };
  const writeDetails = (kind,id,items) => { const all=readDetails(kind);all[id]=items;localStorage.setItem(detailKey(kind),JSON.stringify(all));listeners[kind].get(id)?.(items); };
  return {
    subscribe(callback) { callback(read()); return () => {}; },
    subscribeSubtasks(id,callback) { listeners.subtasks.set(id,callback);callback(readDetails('subtasks')[id]||[]);return()=>listeners.subtasks.delete(id); },
    subscribeComments(id,callback) { listeners.comments.set(id,callback);callback(readDetails('comments')[id]||[]);return()=>listeners.comments.delete(id); },
    subscribeSettings(callback) { listeners.settings=callback;callback(Number(localStorage.getItem('my-capacity-preview-v1'))||240);return()=>{listeners.settings=null}; },
    subscribeProjects(callback) { listeners.projects=callback;callback(JSON.parse(localStorage.getItem('my-projects-preview-v1')||'null')||[...defaultProjects]);return()=>{listeners.projects=null}; },
    async add(task) { const id=crypto.randomUUID();write([...read(), { ...normalizeTask(task), id }]);return id; },
    async update(id, patch) { write(read().map(t => t.id === id ? { ...t, ...patch, updatedAt: new Date().toISOString() } : t)); },
    async remove(id) { for (const kind of ['subtasks','comments']) { const all=readDetails(kind);delete all[id];localStorage.setItem(detailKey(kind),JSON.stringify(all)); } write(read().filter(t => t.id !== id)); },
    async addSubtask(id,text,done=false) { writeDetails('subtasks',id,[...(readDetails('subtasks')[id]||[]),{id:crypto.randomUUID(),text,done,createdAt:new Date().toISOString()}]); },
    async updateSubtask(id,subtaskId,patch) { writeDetails('subtasks',id,(readDetails('subtasks')[id]||[]).map(item=>item.id===subtaskId?{...item,...patch}:item)); },
    async removeSubtask(id,subtaskId) { writeDetails('subtasks',id,(readDetails('subtasks')[id]||[]).filter(item=>item.id!==subtaskId)); },
    async addComment(id,text) { writeDetails('comments',id,[...(readDetails('comments')[id]||[]),{id:crypto.randomUUID(),text,createdAt:new Date().toISOString()}]); },
    async setCapacity(minutes) { localStorage.setItem('my-capacity-preview-v1',String(minutes));listeners.settings?.(minutes); },
    async saveProject(id,name) { const projects=JSON.parse(localStorage.getItem('my-projects-preview-v1')||'null')||[...defaultProjects];const next=projects.some(item=>item.id===id)?projects.map(item=>item.id===id?{...item,name}:item):[...projects,{id,name}];localStorage.setItem('my-projects-preview-v1',JSON.stringify(next));listeners.projects?.(next); }
  };
}

async function startCloud() {
  const [{initializeApp}, authLib, dbLib] = await Promise.all([
    import('./vendor/firebase-app.js'), import('./vendor/firebase-auth.js'), import('./vendor/firebase-firestore.js')
  ]);
  const app = initializeApp(firebaseConfig);
  const auth = authLib.getAuth(app);
  const db = dbLib.initializeFirestore(app, {localCache:dbLib.persistentLocalCache({tabManager:dbLib.persistentMultipleTabManager()})});
  state.cloud = true;
  const tasksFor = user => dbLib.collection(db, 'users', user.uid, 'tasks');
  const subtasksFor = id => dbLib.collection(db,'users',state.user.uid,'tasks',id,'subtasks');
  const commentsFor = id => dbLib.collection(db,'users',state.user.uid,'tasks',id,'comments');
  const settingsRef = user => dbLib.doc(db,'users',user.uid,'settings','planning');
  const projectsFor = user => dbLib.collection(db,'users',user.uid,'projects');
  const trackWrite = promise => { promise.catch(error=>setStatus(`Не удалось сохранить изменения: ${error.message}`)); };
  state.adapter = {
    subscribe(callback) {
      return dbLib.onSnapshot(tasksFor(state.user), {includeMetadataChanges:true}, snapshot => {
        state.snapshotMetadata=snapshot.metadata;
        updateSyncStatus();
        callback(snapshot.docs.map(doc => {
        const data=doc.data();
        return normalizeTask({id:doc.id,...data,createdAt:data.createdAt?.toDate?.().toISOString()||'',updatedAt:data.updatedAt?.toDate?.().toISOString()||''});
        }));
      }, error => setStatus(`Не удалось загрузить дела: ${error.message}`));
    },
    subscribeSubtasks(id,callback) { return dbLib.onSnapshot(subtasksFor(id),snapshot=>callback(snapshot.docs.map(doc=>({id:doc.id,...doc.data()}))),error=>setStatus(`Не удалось загрузить шаги: ${error.message}`)); },
    subscribeComments(id,callback) { return dbLib.onSnapshot(commentsFor(id),snapshot=>callback(snapshot.docs.map(doc=>({id:doc.id,...doc.data(),createdAt:doc.data().createdAt?.toDate?.().toISOString()||''}))),error=>setStatus(`Не удалось загрузить комментарии: ${error.message}`)); },
    subscribeSettings(callback) { return dbLib.onSnapshot(settingsRef(state.user),snapshot=>callback(snapshot.data()?.capacityMin||240),error=>setStatus(`Не удалось загрузить план дня: ${error.message}`)); },
    subscribeProjects(callback) { return dbLib.onSnapshot(projectsFor(state.user),snapshot=>{const saved=snapshot.docs.map(doc=>({id:doc.id,name:doc.data().name,persisted:true}));callback([...defaultProjects.filter(item=>!saved.some(project=>project.id===item.id)),...saved]);},error=>setStatus(`Не удалось загрузить проекты: ${error.message}`)); },
    add(task) { const ref=dbLib.doc(tasksFor(state.user));trackWrite(dbLib.setDoc(ref,{...normalizeTask(task),createdAt:dbLib.serverTimestamp(),updatedAt:dbLib.serverTimestamp()}));return ref.id; },
    update(id, patch) { trackWrite(dbLib.updateDoc(dbLib.doc(tasksFor(state.user),id), {...patch, updatedAt:dbLib.serverTimestamp()})); },
    remove(id) {
      const batch=dbLib.writeBatch(db);
      for(const item of state.subtasks) batch.delete(dbLib.doc(subtasksFor(id),item.id));
      for(const item of state.comments) batch.delete(dbLib.doc(commentsFor(id),item.id));
      batch.delete(dbLib.doc(tasksFor(state.user),id));trackWrite(batch.commit());
    },
    addSubtask(id,text,done=false) { trackWrite(dbLib.addDoc(subtasksFor(id),{text,done,createdAt:dbLib.serverTimestamp(),updatedAt:dbLib.serverTimestamp()})); },
    updateSubtask(id,subtaskId,patch) { trackWrite(dbLib.updateDoc(dbLib.doc(subtasksFor(id),subtaskId),{...patch,updatedAt:dbLib.serverTimestamp()})); },
    removeSubtask(id,subtaskId) { trackWrite(dbLib.deleteDoc(dbLib.doc(subtasksFor(id),subtaskId))); },
    addComment(id,text) { trackWrite(dbLib.addDoc(commentsFor(id),{text,createdAt:dbLib.serverTimestamp()})); },
    setCapacity(minutes) { trackWrite(dbLib.setDoc(settingsRef(state.user),{capacityMin:minutes,updatedAt:dbLib.serverTimestamp()})); },
    saveProject(id,name) { const existing=state.projects.find(item=>item.id===id);const ref=dbLib.doc(projectsFor(state.user),id);trackWrite(existing?.persisted?dbLib.updateDoc(ref,{name,updatedAt:dbLib.serverTimestamp()}):dbLib.setDoc(ref,{name,createdAt:dbLib.serverTimestamp(),updatedAt:dbLib.serverTimestamp()})); }
  };
  authLib.onAuthStateChanged(auth, user => {
    state.unsubscribe?.(); state.unsubscribe = null;
    state.settingsUnsubscribe?.();state.settingsUnsubscribe=null;
    state.projectsUnsubscribe?.();state.projectsUnsubscribe=null;
    state.detailUnsubscribers.forEach(unsubscribe=>unsubscribe());state.detailUnsubscribers=[];state.openTaskId='';
    state.user = user; state.tasks = [];state.projects=[...defaultProjects]; state.snapshotMetadata=null;state.capacityMin=240;
    $('#account-label').textContent = user?.email || '';
    $('#sign-out').hidden = !user;
    if ($('#auth-dialog').open) $('#auth-dialog').close();
    if (user) {
      state.unsubscribe = state.adapter.subscribe(tasks => { state.tasks = tasks; setStatus(''); render(); });
      state.settingsUnsubscribe = state.adapter.subscribeSettings(minutes=>{state.capacityMin=minutes;$('#day-capacity').value=String(minutes/60);render();});
      state.projectsUnsubscribe = state.adapter.subscribeProjects(projects=>{state.projects=projects;render();});
    }
    else $('#auth-dialog').showModal();
    updateSyncStatus();
    render();
  });
  $('#auth-form').addEventListener('submit', async event => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const email = String(data.get('email')).trim();
    const password = String(data.get('password'));
    const submit = $('#auth-submit'); submit.disabled = true; $('#auth-error').textContent = '';
    try {
      if (state.authMode === 'signup') await authLib.createUserWithEmailAndPassword(auth,email,password);
      else await authLib.signInWithEmailAndPassword(auth,email,password);
      event.currentTarget.reset();
    } catch (error) { $('#auth-error').textContent = authMessage(error); }
    finally { submit.disabled = false; }
  });
  $('#auth-switch').addEventListener('click', () => {
    state.authMode = state.authMode === 'login' ? 'signup' : 'login';
    $('#auth-title').textContent = state.authMode === 'signup' ? 'Создать аккаунт' : 'Войти';
    $('#auth-submit').textContent = $('#auth-title').textContent;
    $('#auth-switch').textContent = state.authMode === 'signup' ? 'Уже есть аккаунт? Войти' : 'Создать аккаунт';
    $('#password-reset').hidden = state.authMode === 'signup';
    $('#auth-form [name=password]').autocomplete = state.authMode === 'signup' ? 'new-password' : 'current-password';
    $('#auth-error').textContent = '';
  });
  $('#password-reset').addEventListener('click', async () => {
    const email = $('#auth-form [name=email]').value.trim();
    if (!email) { $('#auth-error').textContent = 'Сначала укажите почту.'; return; }
    try { await authLib.sendPasswordResetEmail(auth,email); $('#auth-error').textContent = 'Письмо для смены пароля отправлено.'; }
    catch (error) { $('#auth-error').textContent = authMessage(error); }
  });
  $('#sign-out').addEventListener('click', () => authLib.signOut(auth));
}

function authMessage(error) {
  const messages = {
    'auth/invalid-credential':'Проверьте почту и пароль. Если вы здесь впервые, нажмите «Создать аккаунт».',
    'auth/email-already-in-use':'Аккаунт с такой почтой уже существует.',
    'auth/weak-password':'Пароль слишком короткий.',
    'auth/invalid-email':'Проверьте адрес почты.',
    'auth/too-many-requests':'Слишком много попыток. Попробуйте позже.'
  };
  return messages[error.code] || 'Не удалось выполнить вход. Попробуйте ещё раз.';
}

function setStatus(message) { $('#status').textContent = message; }
function updateSyncStatus() {
  const element=$('#sync-status');
  if (!state.cloud || !state.user) { element.textContent=''; return; }
  if (!navigator.onLine) element.textContent='Офлайн · изменения сохранятся на этом устройстве';
  else if (!state.snapshotMetadata) element.textContent='Подключение к облаку…';
  else if (state.snapshotMetadata?.hasPendingWrites) element.textContent='Синхронизация…';
  else if (state.snapshotMetadata?.fromCache) element.textContent='Ожидание связи с облаком…';
  else element.textContent='Синхронизировано';
}
window.addEventListener('online',updateSyncStatus);
window.addEventListener('offline',updateSyncStatus);
function setQuickDefaults() {
  const input = $('#quick-form [name=dueDate]');
  if ((state.view === 'nodate' || state.view === 'inbox') && !state.project) input.value = '';
  else if (state.view==='calendar' && !state.project) input.value=state.calendarDate;
  else if (state.view === 'upcoming' && !state.project) { const date=new Date(); date.setDate(date.getDate()+1); input.value=date.toLocaleDateString('sv-SE'); }
  else input.value = today();
  $('#quick-form [name=project]').value = state.project || '';
}
function filteredTasks() { return state.tasks.filter(task => !state.project || projectId(task.project) === state.project).sort(sortTasks); }
function titleForView() { return projectName(state.project) || ({today:'Сегодня',inbox:'Входящие',upcoming:'Ближайшие',calendar:'Календарь',nodate:'Без даты',all:'Все дела'})[state.view]; }
function renderProjects() {
  const nav=$('#project-nav');nav.replaceChildren();
  for(const project of state.projects) {
    const button=document.createElement('button');button.type='button';button.className=`project-item${state.project===project.id?' active':''}`;button.dataset.project=project.id;
    const hash=document.createElement('span');hash.textContent='#';button.append(hash,document.createTextNode(project.name));nav.append(button);
  }
  for(const select of [$('#quick-form [name=project]'),$('#edit-form [name=project]')]) {
    const value=select.value;select.replaceChildren(new Option('Без проекта',''));
    for(const project of state.projects)select.add(new Option(project.name,project.id));
    select.value=projectId(value);
  }
}

function render() {
  renderProjects();
  if ($('#projects-dialog').open) renderProjectDialog();
  const date = new Date();
  $('#date-label').textContent = date.toLocaleDateString('ru-RU', {weekday:'long',day:'numeric',month:'long'});
  $('#page-title').textContent = titleForView();
  const tasks = filteredTasks();
  renderReminders();
  const active = tasks.filter(t => !t.done);
  const counts = {today:active.filter(t=>category(t)==='today'||t.plannedDate===today()).length, inbox:active.filter(t=>!t.dueDate&&!t.project).length, upcoming:active.filter(t=>category(t)==='upcoming').length, nodate:active.filter(t=>category(t)==='nodate').length, all:active.length};
  for (const [name,count] of Object.entries(counts)) $(`#count-${name}`).textContent = count;
  document.querySelectorAll('[data-view]').forEach(button => button.classList.toggle('active',button.dataset.view===state.view && !state.project));
  $('#calendar').hidden=state.view!=='calendar'||!!state.project;
  $('#task-sections').hidden=state.view==='calendar'&&!state.project;
  if (state.view==='calendar'&&!state.project) renderCalendar();
  $('#day-plan').hidden=state.view!=='today'||!!state.project;
  const todayTasks=active.filter(task=>task.plannedDate===today()||category(task)==='today');
  const estimated=todayTasks.reduce((sum,task)=>sum+(Number(task.estimateMin)||0),0);
  const withoutEstimate=todayTasks.filter(task=>!Number(task.estimateMin)).length;
  $('#day-plan-summary').textContent=!todayTasks.length?'Дел на сегодня нет':`${taskCountLabel(todayTasks.length)} · ${estimated?`оценено ${estimateLabel(estimated)} из ${estimateLabel(state.capacityMin)}${withoutEstimate?` · без оценки: ${withoutEstimate}`:''}`:'время не указано'}${estimated>state.capacityMin?' · времени не хватает':''}`;
  $('#day-plan').classList.toggle('overloaded',estimated>state.capacityMin);
  const sections = state.project || state.view === 'all' ? ['today','upcoming','nodate'] : state.view==='today' ? ['plan','due'] : [state.view];
  const wrapper = $('#task-sections'); wrapper.replaceChildren();
  const labels = {today:'Сегодня',plan:'Главное на сегодня',due:'Срок сегодня',inbox:'Записано без даты',upcoming:'Ближайшие',nodate:'Без даты'};
  for (const sectionName of sections) {
    const section = document.createElement('section'); section.className='section';
    const sectionTasks = tasks.filter(task => sectionName==='plan' ? task.plannedDate===today() : sectionName==='due' ? category(task)==='today'&&task.plannedDate!==today() : sectionName==='inbox' ? !task.dueDate&&!task.project : category(task)===sectionName);
    const head = document.createElement('div'); head.className='section-head';
    const h2 = document.createElement('h2'); h2.textContent=labels[sectionName];
    const count = document.createElement('span'); count.className='section-count'; count.textContent=`${sectionTasks.filter(t=>!t.done).length} ${sectionTasks.filter(t=>!t.done).length===1?'дело':'дел'}`;
    head.append(h2,count); section.append(head);
    if (!sectionTasks.length) { const empty=document.createElement('p'); empty.className='empty'; empty.textContent=sectionName==='plan'?'Выбери несколько дел на сегодня кнопкой ☆.':sectionName==='due'?'Срочных дел нет.':'Здесь пока пусто.'; section.append(empty); }
    for (const task of sectionTasks) section.append(taskRow(task));
    wrapper.append(section);
  }
}

function renderCalendar() {
  const container=$('#calendar');container.replaceChildren();
  const [year,month]=state.calendarMonth.split('-').map(Number);
  const first=new Date(year,month-1,1),daysInMonth=new Date(year,month,0).getDate();
  const header=document.createElement('div');header.className='calendar-head';
  const back=document.createElement('button');back.type='button';back.textContent='←';back.setAttribute('aria-label','Предыдущий месяц');back.addEventListener('click',()=>changeCalendarMonth(-1));
  const title=document.createElement('strong');title.textContent=first.toLocaleDateString('ru-RU',{month:'long',year:'numeric'});
  const next=document.createElement('button');next.type='button';next.textContent='→';next.setAttribute('aria-label','Следующий месяц');next.addEventListener('click',()=>changeCalendarMonth(1));
  header.append(back,title,next);container.append(header);
  const grid=document.createElement('div');grid.className='calendar-grid';
  for(const weekday of ['Пн','Вт','Ср','Чт','Пт','Сб','Вс']){const label=document.createElement('span');label.className='calendar-weekday';label.textContent=weekday;grid.append(label);}
  for(let i=0;i<(first.getDay()+6)%7;i++){const blank=document.createElement('span');blank.className='calendar-blank';grid.append(blank);}
  for(let day=1;day<=daysInMonth;day++){
    const date=`${state.calendarMonth}-${String(day).padStart(2,'0')}`;
    const tasks=state.tasks.filter(task=>task.dueDate===date&&!task.done).sort(sortTasks);
    const button=document.createElement('button');button.type='button';button.className=`calendar-day${date===today()?' current':''}${date===state.calendarDate?' selected':''}`;
    const number=document.createElement('b');number.textContent=String(day);button.append(number);
    for(const task of tasks.slice(0,2)){const item=document.createElement('span');item.className=`calendar-task ${task.priority||''}`;item.textContent=task.title;button.append(item);}
    if(tasks.length>2){const more=document.createElement('small');more.textContent=`+${tasks.length-2}`;button.append(more);}
    button.setAttribute('aria-label',`${day} ${title.textContent}: ${tasks.length} дел`);
    button.addEventListener('click',()=>{state.calendarDate=date;setQuickDefaults();render();});grid.append(button);
  }
  container.append(grid);
  const selected=document.createElement('div');selected.className='calendar-selected';
  const heading=document.createElement('h2');heading.textContent=new Date(`${state.calendarDate}T12:00:00`).toLocaleDateString('ru-RU',{day:'numeric',month:'long'});selected.append(heading);
  const selectedTasks=state.tasks.filter(task=>task.dueDate===state.calendarDate).sort(sortTasks);
  if(!selectedTasks.length){const empty=document.createElement('p');empty.className='empty';empty.textContent='На этот день пока нет дел.';selected.append(empty);}
  for(const task of selectedTasks)selected.append(taskRow(task));container.append(selected);
}
function changeCalendarMonth(delta){const [year,month]=state.calendarMonth.split('-').map(Number);const date=new Date(year,month-1+delta,1);state.calendarMonth=date.toLocaleDateString('sv-SE').slice(0,7);state.calendarDate=`${state.calendarMonth}-01`;setQuickDefaults();render();}

function renderReminders() {
  const container=$('#reminder-list');container.replaceChildren();
  const now=Date.now();
  const due=state.tasks.filter(task=>!task.done&&task.remindAt&&Date.parse(task.remindAt)<=now).sort(sortTasks);
  if (!due.length) return;
  const label=document.createElement('strong');label.textContent='Напоминания';container.append(label);
  for (const task of due) {
    const button=document.createElement('button');button.type='button';button.textContent=task.title;
    button.addEventListener('click',()=>openTask(task));container.append(button);
  }
}
setInterval(renderReminders,30000);

function taskRow(task) {
  const row=document.createElement('div'); row.className=`task${task.done?' done':''}${isOverdue(task)?' overdue':''}`;
  const checkbox=document.createElement('input'); checkbox.type='checkbox'; checkbox.className='task-check'; checkbox.checked=!!task.done; checkbox.setAttribute('aria-label',`Выполнено: ${task.title}`);
  checkbox.addEventListener('change',()=>{
    if (checkbox.checked && task.repeat && task.dueDate) {
      const patch=repeatPatch(task);
      mutate(()=>state.adapter.update(task.id,patch));
      setStatus(`Повторяющееся дело перенесено на ${dateLabel(patch.dueDate)}.`);
    } else mutate(()=>state.adapter.update(task.id,{done:checkbox.checked}));
  });
  const body=document.createElement('button'); body.type='button';body.className='task-body';body.setAttribute('aria-label',`Открыть дело: ${task.title}`);body.addEventListener('click',()=>openTask(task));
  const title=document.createElement('span'); title.className='task-title'; title.textContent=task.title; body.append(title);
  const meta=document.createElement('div'); meta.className='task-meta';
  if (task.priority) { const priority=document.createElement('span'); priority.className=`task-priority ${task.priority}`;priority.textContent=({high:'Важное',medium:'Среднее',low:'Низкое'})[task.priority];meta.append(priority); }
  if (task.project) { const project=document.createElement('span'); project.className='task-project'; project.textContent=projectName(task.project); meta.append(project); }
  if (task.dueDate) { const due=document.createElement('span'); due.className='task-date'; due.textContent=isOverdue(task)?`Просрочено · ${dateLabel(task.dueDate)}`:dateLabel(task.dueDate); meta.append(due); }
  if (task.estimateMin) { const estimate=document.createElement('span');estimate.className='task-date';estimate.textContent=estimateLabel(Number(task.estimateMin));meta.append(estimate); }
  body.append(meta);
  const plan=document.createElement('button');plan.type='button';plan.className=`task-plan${task.plannedDate===today()?' active':''}`;plan.textContent=task.plannedDate===today()?'★':'☆';plan.setAttribute('aria-label',task.plannedDate===today()?`Убрать из плана: ${task.title}`:`В план на сегодня: ${task.title}`);
  plan.addEventListener('click',()=>mutate(()=>state.adapter.update(task.id,{plannedDate:task.plannedDate===today()?'':today()})));
  const menu=document.createElement('button'); menu.type='button'; menu.className='task-menu'; menu.textContent='⋯'; menu.setAttribute('aria-label',`Изменить: ${task.title}`); menu.addEventListener('click',()=>openTask(task));
  row.append(checkbox,body,plan,menu);
  row.addEventListener('click',event=>{if(event.target===row)openTask(task);});
  return row;
}

function openTask(task) {
  closeDetails();state.openTaskId=task.id;
  $('#task-dialog-title').textContent='Изменить дело';$('#save-task').textContent='Сохранить';$('#delete-task').hidden=false;$('#comment-form button').textContent='Отправить';
  const form=$('#edit-form');form.elements.id.value=task.id;form.elements.title.value=task.title;form.elements.dueDate.value=task.dueDate||'';form.elements.project.value=projectId(task.project);
  form.elements.priority.value=task.priority||'';form.elements.estimateMin.value=String(task.estimateMin||0);form.elements.repeat.value=task.repeat||'';
  form.elements.remindAt.value=task.remindAt?localDateTime(task.remindAt):'';form.elements.plannedToday.checked=task.plannedDate===today();
  $('#task-error').textContent='';state.subtasks=[];state.comments=[];renderTaskDetails();
  state.detailUnsubscribers=[
    state.adapter.subscribeSubtasks(task.id,items=>{state.subtasks=items;renderTaskDetails();}),
    state.adapter.subscribeComments(task.id,items=>{state.comments=items;renderTaskDetails();})
  ];
  $('#task-dialog').showModal();form.elements.title.focus();
}
function openCreateTask() {
  if(state.cloud&&!state.user){$('#auth-dialog').showModal();return;}
  closeDetails();state.subtasks=[];state.comments=[];
  const quick=$('#quick-form').elements,form=$('#edit-form');form.reset();
  form.elements.id.value='';form.elements.title.value=quick.title.value.trim();
  form.elements.dueDate.value=quick.dueDate.value;form.elements.project.value=quick.project.value;form.elements.priority.value=quick.priority.value;
  form.elements.plannedToday.checked=state.view==='today'&&!state.project;
  $('#task-dialog-title').textContent='Новое дело';$('#save-task').textContent='Создать дело';$('#delete-task').hidden=true;$('#comment-form button').textContent='Добавить';$('#task-error').textContent='';
  $('#subtask-form').reset();$('#comment-form').reset();renderTaskDetails();$('#task-dialog').showModal();form.elements.title.focus();
}
function localDateTime(value) { const date=new Date(value);return `${date.toLocaleDateString('sv-SE')}T${String(date.getHours()).padStart(2,'0')}:${String(date.getMinutes()).padStart(2,'0')}`; }
function closeDetails() { state.detailUnsubscribers.forEach(unsubscribe=>unsubscribe());state.detailUnsubscribers=[];state.openTaskId=''; }
function validProjectName(name,id='') {
  if(!name||name.length>40||name.includes('/'))return 'Название проекта: от 1 до 40 символов, без /.';
  if(state.projects.some(project=>project.id!==id&&project.name.toLocaleLowerCase()===name.toLocaleLowerCase()))return 'Проект с таким названием уже есть.';
  return '';
}
function renderProjectDialog() {
  const list=$('#project-list');list.replaceChildren();
  for(const project of state.projects) {
    const row=document.createElement('form');row.className='project-row';
    const open=document.createElement('button');open.type='button';open.textContent='#';open.setAttribute('aria-label',`Открыть проект ${project.name}`);
    open.addEventListener('click',()=>{state.project=project.id;state.view='all';$('#projects-dialog').close();setQuickDefaults();render();});
    const input=document.createElement('input');input.value=project.name;input.maxLength=40;input.setAttribute('aria-label',`Название проекта ${project.name}`);
    const save=document.createElement('button');save.type='submit';save.textContent='Сохранить';
    row.addEventListener('submit',async event=>{event.preventDefault();const name=input.value.trim();const error=validProjectName(name,project.id);$('#project-error').textContent=error;if(error)return;await mutate(()=>state.adapter.saveProject(project.id,name));});
    row.append(open,input,save);list.append(row);
  }
}
function renderTaskDetails() {
  const steps=$('#subtask-list');steps.replaceChildren();
  const createdAt=item=>item.createdAt?.toDate?.()?.toISOString()||item.createdAt||'';
  for(const item of [...state.subtasks].sort((a,b)=>createdAt(a).localeCompare(createdAt(b)))) {
    const row=document.createElement('div');row.className='detail-row';
    const check=document.createElement('input');check.type='checkbox';check.checked=!!item.done;check.setAttribute('aria-label',`Шаг выполнен: ${item.text}`);
    check.addEventListener('change',()=>{if(!state.openTaskId){item.done=check.checked;renderTaskDetails();}else mutate(()=>state.adapter.updateSubtask(state.openTaskId,item.id,{done:check.checked}));});
    const text=document.createElement('span');text.textContent=item.text;if(item.done)text.className='completed';
    const remove=document.createElement('button');remove.type='button';remove.textContent='×';remove.setAttribute('aria-label',`Удалить шаг: ${item.text}`);
    remove.addEventListener('click',()=>{if(!state.openTaskId){state.subtasks=state.subtasks.filter(step=>step.id!==item.id);renderTaskDetails();}else mutate(()=>state.adapter.removeSubtask(state.openTaskId,item.id));});
    row.append(check,text,remove);steps.append(row);
  }
  const comments=$('#comment-list');comments.replaceChildren();
  for(const item of [...state.comments].sort((a,b)=>(a.createdAt||'').localeCompare(b.createdAt||''))) {
    const row=document.createElement('div');row.className='comment-row';
    const text=document.createElement('p');text.textContent=item.text;
    const time=document.createElement('small');time.textContent=item.createdAt?new Date(item.createdAt).toLocaleString('ru-RU',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}):'Сейчас';
    row.append(text,time);
    if(!state.openTaskId){const remove=document.createElement('button');remove.type='button';remove.textContent='×';remove.setAttribute('aria-label','Убрать комментарий');remove.addEventListener('click',()=>{state.comments=state.comments.filter(comment=>comment.id!==item.id);renderTaskDetails();});row.append(remove);}
    comments.append(row);
  }
}
async function mutate(operation) { try { setStatus(''); return await operation(); } catch(error) { setStatus(`Не удалось сохранить дело: ${error.message}`); } }

function openMenu(){document.body.classList.add('menu-open');$('#drawer-backdrop').hidden=false;$('#mobile-menu').setAttribute('aria-expanded','true');}
function closeMenu(){document.body.classList.remove('menu-open');$('#drawer-backdrop').hidden=true;$('#mobile-menu').setAttribute('aria-expanded','false');}
$('#mobile-menu').addEventListener('click',openMenu);
$('#close-menu').addEventListener('click',closeMenu);
$('#drawer-backdrop').addEventListener('click',closeMenu);
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&document.body.classList.contains('menu-open'))closeMenu();});
document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click',()=>{state.view=button.dataset.view;state.project='';closeMenu();setQuickDefaults();render();window.scrollTo(0,0)}));
$('#project-nav').addEventListener('click',event=>{const button=event.target.closest('[data-project]');if(!button)return;state.project=button.dataset.project;state.view='all';closeMenu();setQuickDefaults();render();window.scrollTo(0,0)});
$('#manage-projects').addEventListener('click',()=>{closeMenu();$('#project-error').textContent='';renderProjectDialog();$('#projects-dialog').showModal();});
$('#project-form').addEventListener('submit',async event=>{event.preventDefault();const name=event.currentTarget.elements.name.value.trim();const error=validProjectName(name)|| (state.projects.length>=30?'Можно создать не больше 30 проектов.':'');$('#project-error').textContent=error;if(error)return;await mutate(()=>state.adapter.saveProject(crypto.randomUUID(),name));event.currentTarget.reset();});
document.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click',()=>document.getElementById(button.dataset.close).close()));
document.querySelectorAll('dialog').forEach(dialog=>dialog.addEventListener('click',event=>{
  if(event.target!==dialog)return;
  const bounds=dialog.getBoundingClientRect();
  if(event.clientX<bounds.left||event.clientX>bounds.right||event.clientY<bounds.top||event.clientY>bounds.bottom)dialog.close();
}));
$('#task-dialog').addEventListener('close',closeDetails);
$('#day-capacity').addEventListener('change',event=>{const hours=Number(event.target.value);if(!Number.isFinite(hours)||hours<1||hours>16){event.target.value=String(state.capacityMin/60);return;}mutate(()=>state.adapter.setCapacity(Math.round(hours*60)));});
$('#subtask-form').addEventListener('submit',async event=>{event.preventDefault();const text=event.currentTarget.elements.text.value.trim();if(!text)return;if(state.openTaskId)await mutate(()=>state.adapter.addSubtask(state.openTaskId,text));else{state.subtasks.push({id:crypto.randomUUID(),text,done:false,createdAt:new Date().toISOString()});renderTaskDetails();}event.currentTarget.reset();});
$('#comment-form').addEventListener('submit',async event=>{event.preventDefault();const text=event.currentTarget.elements.text.value.trim();if(!text)return;if(state.openTaskId)await mutate(()=>state.adapter.addComment(state.openTaskId,text));else{state.comments.push({id:crypto.randomUUID(),text,createdAt:new Date().toISOString()});renderTaskDetails();}event.currentTarget.reset();});
$('#detailed-add').addEventListener('click',openCreateTask);
$('#account-button').addEventListener('click',()=>{if(state.cloud && !state.user) $('#auth-dialog').showModal(); else if(state.cloud) setStatus(`Вход выполнен: ${state.user.email}`); else setStatus('Это локальный предпросмотр. Облачный вход пока не подключён.')});
$('#quick-form').addEventListener('submit', async event => {
  event.preventDefault(); if(state.cloud && !state.user) {$('#auth-dialog').showModal();return;}
  const form=event.currentTarget; const data=new FormData(form); const title=String(data.get('title')).trim(); if(!title)return;
  const task={title,dueDate:String(data.get('dueDate')||''),project:String(data.get('project')||''),priority:String(data.get('priority')||''),estimateMin:0,repeat:'',remindAt:'',plannedDate:state.view==='today'&&!state.project?today():'',repeatAnchor:0,done:false,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
  await mutate(()=>state.adapter.add(task)); form.reset(); setQuickDefaults(); $('#quick-title').focus();
});
$('#edit-form').addEventListener('submit', async event => {
  event.preventDefault();if(state.cloud&&!state.user){$('#auth-dialog').showModal();return;}
  const data=new FormData(event.currentTarget); const existingId=String(data.get('id')); const title=String(data.get('title')).trim(); if(!title)return;
  const dueDate=String(data.get('dueDate')||'');const repeat=String(data.get('repeat')||'');
  if(repeat&&!dueDate){$('#task-error').textContent='Для повтора укажи дату дела.';return;}
  const estimateMin=Number(data.get('estimateMin')||0);
  if(!Number.isInteger(estimateMin)||estimateMin<0||estimateMin>1440){$('#task-error').textContent='Оценка времени должна быть от 0 до 1440 минут.';return;}
  const reminder=String(data.get('remindAt')||'');
  const patch={title,dueDate,project:String(data.get('project')||''),priority:String(data.get('priority')||''),estimateMin,repeat,
    remindAt:reminder?new Date(reminder).toISOString():'',plannedDate:data.has('plannedToday')?today():'',repeatAnchor:repeat==='monthly'?Number(dueDate.slice(-2)):0};
  const pendingStep=$('#subtask-form').elements.text.value.trim();
  const pendingComment=$('#comment-form').elements.text.value.trim();
  const save=$('#save-task');if(save.disabled)return;save.disabled=true;
  try{
    if(existingId){
      await mutate(()=>state.adapter.update(existingId,patch));
      if(pendingStep)await mutate(()=>state.adapter.addSubtask(existingId,pendingStep));
      if(pendingComment)await mutate(()=>state.adapter.addComment(existingId,pendingComment));
    }else{
      const id=await mutate(()=>state.adapter.add({...patch,done:false,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()}));
      if(!id)return;
      for(const step of state.subtasks)await mutate(()=>state.adapter.addSubtask(id,step.text,step.done));
      if(pendingStep)await mutate(()=>state.adapter.addSubtask(id,pendingStep));
      for(const comment of state.comments)await mutate(()=>state.adapter.addComment(id,comment.text));
      if(pendingComment)await mutate(()=>state.adapter.addComment(id,pendingComment));
      $('#quick-form').reset();setQuickDefaults();
    }
    $('#task-dialog').close();
  }finally{save.disabled=false;}
});
$('#delete-task').addEventListener('click', async()=>{const id=$('#edit-form').elements.id.value;if(!confirm('Удалить это дело?'))return;await mutate(()=>state.adapter.remove(id));$('#task-dialog').close()});

setQuickDefaults();
if ('serviceWorker' in navigator) window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(error=>console.warn('Service worker:',error)));
if (firebaseConfig?.apiKey && firebaseConfig?.projectId) {
  startCloud().catch(error=>{setStatus(`Не удалось подключить облако: ${error.message}`);$('#mode-banner').hidden=false;$('#mode-banner').textContent='Облако недоступно. Локальный предпросмотр не включён, чтобы не потерять синхронизацию.';render()});
} else {
  state.adapter=localAdapter(); $('#mode-banner').hidden=false; state.unsubscribe=state.adapter.subscribe(tasks=>{state.tasks=tasks.map(normalizeTask);render()});
  state.settingsUnsubscribe=state.adapter.subscribeSettings(minutes=>{state.capacityMin=minutes;$('#day-capacity').value=String(minutes/60);render()});
  state.projectsUnsubscribe=state.adapter.subscribeProjects(projects=>{state.projects=projects;render()});
}

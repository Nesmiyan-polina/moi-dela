import { firebaseConfig } from './firebase-config.js';

const $ = (selector) => document.querySelector(selector);
const state = { tasks: [], view: 'today', project: '', user: null, cloud: false, adapter: null, unsubscribe: null, authMode: 'login' };
const today = () => new Date().toLocaleDateString('sv-SE');
const dateLabel = (value) => value ? new Date(`${value}T12:00:00`).toLocaleDateString('ru-RU', {day:'numeric', month:'short'}) : '';
const taskDate = (task) => task.dueDate || '';
const isOverdue = (task) => !task.done && taskDate(task) && taskDate(task) < today();
const category = (task) => !taskDate(task) ? 'nodate' : taskDate(task) <= today() ? 'today' : 'upcoming';
const sortTasks = (a,b) => Number(a.done)-Number(b.done) || (a.dueDate || '9999').localeCompare(b.dueDate || '9999') || (a.createdAt || '').localeCompare(b.createdAt || '');

function localAdapter() {
  const key = 'my-tasks-preview-v1';
  const read = () => { try { return JSON.parse(localStorage.getItem(key) || '[]'); } catch { return []; } };
  const write = tasks => { localStorage.setItem(key, JSON.stringify(tasks)); state.tasks = tasks; render(); };
  return {
    subscribe(callback) { callback(read()); return () => {}; },
    async add(task) { write([...read(), { ...task, id: crypto.randomUUID() }]); },
    async update(id, patch) { write(read().map(t => t.id === id ? { ...t, ...patch, updatedAt: new Date().toISOString() } : t)); },
    async remove(id) { write(read().filter(t => t.id !== id)); }
  };
}

async function startCloud() {
  const base = 'https://www.gstatic.com/firebasejs/13.2.0/';
  const [{initializeApp}, authLib, dbLib] = await Promise.all([
    import(`${base}firebase-app.js`), import(`${base}firebase-auth.js`), import(`${base}firebase-firestore.js`)
  ]);
  const app = initializeApp(firebaseConfig);
  const auth = authLib.getAuth(app);
  const db = dbLib.getFirestore(app);
  state.cloud = true;
  const tasksFor = user => dbLib.collection(db, 'users', user.uid, 'tasks');
  state.adapter = {
    subscribe(callback) {
      return dbLib.onSnapshot(tasksFor(state.user), snapshot => callback(snapshot.docs.map(doc => {
        const data=doc.data();
        return {id:doc.id,...data,createdAt:data.createdAt?.toDate?.().toISOString()||'',updatedAt:data.updatedAt?.toDate?.().toISOString()||''};
      })), error => setStatus(`Не удалось загрузить дела: ${error.message}`));
    },
    add(task) { return dbLib.addDoc(tasksFor(state.user), {...task,createdAt:dbLib.serverTimestamp(),updatedAt:dbLib.serverTimestamp()}); },
    update(id, patch) { return dbLib.updateDoc(dbLib.doc(tasksFor(state.user),id), {...patch, updatedAt:dbLib.serverTimestamp()}); },
    remove(id) { return dbLib.deleteDoc(dbLib.doc(tasksFor(state.user),id)); }
  };
  authLib.onAuthStateChanged(auth, user => {
    state.unsubscribe?.(); state.unsubscribe = null;
    state.user = user; state.tasks = [];
    $('#account-label').textContent = user?.email || '';
    $('#sign-out').hidden = !user;
    if ($('#auth-dialog').open) $('#auth-dialog').close();
    if (user) state.unsubscribe = state.adapter.subscribe(tasks => { state.tasks = tasks; setStatus(''); render(); });
    else $('#auth-dialog').showModal();
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
    'auth/invalid-credential':'Проверьте почту и пароль.',
    'auth/email-already-in-use':'Аккаунт с такой почтой уже существует.',
    'auth/weak-password':'Пароль слишком короткий.',
    'auth/invalid-email':'Проверьте адрес почты.',
    'auth/too-many-requests':'Слишком много попыток. Попробуйте позже.'
  };
  return messages[error.code] || 'Не удалось выполнить вход. Попробуйте ещё раз.';
}

function setStatus(message) { $('#status').textContent = message; }
function setQuickDefaults() {
  const input = $('#quick-form [name=dueDate]');
  if (state.view === 'nodate' && !state.project) input.value = '';
  else if (state.view === 'upcoming' && !state.project) { const date=new Date(); date.setDate(date.getDate()+1); input.value=date.toLocaleDateString('sv-SE'); }
  else input.value = today();
  $('#quick-form [name=project]').value = state.project || '';
}
function filteredTasks() { return state.tasks.filter(task => !state.project || task.project === state.project).sort(sortTasks); }
function titleForView() { return state.project || ({today:'Сегодня',upcoming:'Ближайшие',nodate:'Без даты',all:'Все дела'})[state.view]; }

function render() {
  const date = new Date();
  $('#date-label').textContent = date.toLocaleDateString('ru-RU', {weekday:'long',day:'numeric',month:'long'});
  $('#page-title').textContent = titleForView();
  const tasks = filteredTasks();
  const active = tasks.filter(t => !t.done);
  const counts = {today:active.filter(t=>category(t)==='today').length, upcoming:active.filter(t=>category(t)==='upcoming').length, nodate:active.filter(t=>category(t)==='nodate').length, all:active.length};
  for (const [name,count] of Object.entries(counts)) $(`#count-${name}`).textContent = count;
  document.querySelectorAll('[data-view]').forEach(button => button.classList.toggle('active',button.dataset.view===state.view && !state.project));
  document.querySelectorAll('[data-project]').forEach(button => button.classList.toggle('active',button.dataset.project===state.project));
  const sections = state.project || state.view === 'all' ? ['today','upcoming','nodate'] : [state.view];
  const wrapper = $('#task-sections'); wrapper.replaceChildren();
  const labels = {today:'Сегодня',upcoming:'Ближайшие',nodate:'Без даты'};
  for (const sectionName of sections) {
    const section = document.createElement('section'); section.className='section';
    const sectionTasks = tasks.filter(t => category(t) === sectionName);
    const head = document.createElement('div'); head.className='section-head';
    const h2 = document.createElement('h2'); h2.textContent=labels[sectionName];
    const count = document.createElement('span'); count.className='section-count'; count.textContent=`${sectionTasks.filter(t=>!t.done).length} ${sectionTasks.filter(t=>!t.done).length===1?'дело':'дел'}`;
    head.append(h2,count); section.append(head);
    if (!sectionTasks.length) { const empty=document.createElement('p'); empty.className='empty'; empty.textContent=sectionName==='today'?'На сегодня дел нет. Можно выдохнуть или добавить новое.':'Здесь пока пусто.'; section.append(empty); }
    for (const task of sectionTasks) section.append(taskRow(task));
    wrapper.append(section);
  }
}

function taskRow(task) {
  const row=document.createElement('div'); row.className=`task${task.done?' done':''}${isOverdue(task)?' overdue':''}`;
  const checkbox=document.createElement('input'); checkbox.type='checkbox'; checkbox.className='task-check'; checkbox.checked=!!task.done; checkbox.setAttribute('aria-label',`Выполнено: ${task.title}`);
  checkbox.addEventListener('change',()=>mutate(()=>state.adapter.update(task.id,{done:checkbox.checked})));
  const body=document.createElement('div'); body.className='task-body';
  const title=document.createElement('span'); title.className='task-title'; title.textContent=task.title; body.append(title);
  const meta=document.createElement('div'); meta.className='task-meta';
  if (task.project) { const project=document.createElement('span'); project.className='task-project'; project.textContent=task.project; meta.append(project); }
  if (task.dueDate) { const due=document.createElement('span'); due.className='task-date'; due.textContent=isOverdue(task)?`Просрочено · ${dateLabel(task.dueDate)}`:dateLabel(task.dueDate); meta.append(due); }
  body.append(meta);
  const menu=document.createElement('button'); menu.type='button'; menu.className='task-menu'; menu.textContent='⋯'; menu.setAttribute('aria-label',`Изменить: ${task.title}`); menu.addEventListener('click',()=>openTask(task));
  row.append(checkbox,body,menu); return row;
}

function openTask(task) {
  const form=$('#edit-form'); form.elements.id.value=task.id; form.elements.title.value=task.title; form.elements.dueDate.value=task.dueDate||''; form.elements.project.value=task.project||''; $('#task-dialog').showModal(); form.elements.title.focus();
}
async function mutate(operation) { try { setStatus(''); await operation(); } catch(error) { setStatus(`Не удалось сохранить дело: ${error.message}`); } }

document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click',()=>{state.view=button.dataset.view;state.project='';setQuickDefaults();render();window.scrollTo(0,0)}));
document.querySelectorAll('[data-project]').forEach(button => button.addEventListener('click',()=>{state.project=button.dataset.project;state.view='all';setQuickDefaults();render();window.scrollTo(0,0)}));
document.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click',()=>document.getElementById(button.dataset.close).close()));
$('#account-button').addEventListener('click',()=>{if(state.cloud && !state.user) $('#auth-dialog').showModal(); else if(state.cloud) setStatus(`Вход выполнен: ${state.user.email}`); else setStatus('Это локальный предпросмотр. Облачный вход пока не подключён.')});
$('#quick-form').addEventListener('submit', async event => {
  event.preventDefault(); if(state.cloud && !state.user) {$('#auth-dialog').showModal();return;}
  const form=event.currentTarget; const data=new FormData(form); const title=String(data.get('title')).trim(); if(!title)return;
  const task={title,dueDate:String(data.get('dueDate')||''),project:String(data.get('project')||''),done:false,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
  await mutate(()=>state.adapter.add(task)); form.reset(); setQuickDefaults(); $('#quick-title').focus();
});
$('#edit-form').addEventListener('submit', async event => {
  event.preventDefault(); const data=new FormData(event.currentTarget); const id=String(data.get('id')); const title=String(data.get('title')).trim(); if(!title)return;
  await mutate(()=>state.adapter.update(id,{title,dueDate:String(data.get('dueDate')||''),project:String(data.get('project')||'')})); $('#task-dialog').close();
});
$('#delete-task').addEventListener('click', async()=>{const id=$('#edit-form').elements.id.value;if(!confirm('Удалить это дело?'))return;await mutate(()=>state.adapter.remove(id));$('#task-dialog').close()});

setQuickDefaults();
if (firebaseConfig?.apiKey && firebaseConfig?.projectId) {
  startCloud().catch(error=>{setStatus(`Не удалось подключить облако: ${error.message}`);$('#mode-banner').hidden=false;$('#mode-banner').textContent='Облако недоступно. Локальный предпросмотр не включён, чтобы не потерять синхронизацию.';render()});
} else {
  state.adapter=localAdapter(); $('#mode-banner').hidden=false; state.unsubscribe=state.adapter.subscribe(tasks=>{state.tasks=tasks;render()});
}

(() => {
'use strict';

const DATA = window.EIKEN4_DATA || {meta:{},words:[],phrases:[],questions:[]};
const WORDS = DATA.words || [];
const PHRASES = DATA.phrases || [];
const QUESTIONS = DATA.questions || [];
const ALL = [
  ...WORDS.map(x => ({...x, kind:'word', word:x.word, key:'w:'+x.id})),
  ...PHRASES.map(x => ({...x, kind:'phrase', word:x.phrase, main_pos:'熟語・表現', countability:'', noun_note:'', key:'p:'+x.id}))
];
const STORAGE_KEY = 'eiken4-vocab-lab-v1'; // keep the v1 key so existing progress survives
const PER_SET = 10;
const DAY = 86400000;

let state = loadState();
let quiz = null;
let deferredInstallPrompt = null;
let listLimit = 120;

const main = document.querySelector('#main');

function defaultState(){
  return {
    version:2,
    stats:{},
    history:[],
    fixedSet:0,
    phraseSet:0,
    streak:{count:0,lastDay:null},
    settings:{
      sessionLength:'50',
      customCount:50,
      fastMode:true,
      direction:'ja-en',
      theme:'system',
      priority:'A',
      category:'',
      mainPos:''
    }
  };
}
function loadState(){
  const d=defaultState();
  try{
    const parsed=JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
    return {
      ...d,
      ...parsed,
      version:2,
      streak:{...d.streak,...(parsed.streak||{})},
      settings:{...d.settings,...(parsed.settings||{})},
      stats:parsed.stats||{},
      history:parsed.history||[]
    };
  }catch(e){ return d; }
}
function saveState(){ localStorage.setItem(STORAGE_KEY,JSON.stringify(state)); }
function effectiveDark(){
  return state.settings.theme==='dark'||(state.settings.theme==='system'&&window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches);
}
function applyTheme(){
  const root=document.documentElement;
  if(state.settings.theme==='system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme',state.settings.theme);
  const btn=document.querySelector('#themeBtn');
  if(btn){
    btn.textContent=effectiveDark()?'LIGHT':'DARK';
    btn.setAttribute('aria-label',effectiveDark()?'ライトモードに切り替える':'ダークモードに切り替える');
  }
}
function toggleTheme(){state.settings.theme=effectiveDark()?'light':'dark';saveState();applyTheme();}
function recallMode(){return state.settings.direction==='en-ja'?'enja':'typing';}
function recallLabel(){return state.settings.direction==='en-ja'?'意味選択':'綴り入力';}
function esc(v){
  return String(v ?? '').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
}
function normEnglish(v){
  return String(v ?? '')
    .toLowerCase().trim()
    .replace(/[’‘`]/g,"'")
    .replace(/[.,!?;:]+$/g,'')
    .replace(/\s+/g,' ');
}
function splitAnswers(v){
  if(Array.isArray(v)) return v.map(String).map(x=>x.trim()).filter(Boolean);
  return String(v||'').split(/[;；\n|]+/).map(x=>x.trim()).filter(Boolean);
}
function acceptedAnswers(item){
  const all=[item.word,...splitAnswers(item.accepted_answers)];
  const seen=new Set();
  return all.filter(x=>{const n=normEnglish(x);if(!n||seen.has(n))return false;seen.add(n);return true;});
}
function shuffle(a){
  const c=[...a];
  for(let i=c.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[c[i],c[j]]=[c[j],c[i]];}
  return c;
}
function sample(a,n){ return shuffle(a).slice(0,Math.min(n,a.length)); }
function localDay(d=new Date()){
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function updateDailyStreak(){
  const today=localDay();
  if(state.streak.lastDay===today) return;
  if(!state.streak.lastDay){ state.streak={count:1,lastDay:today}; }
  else{
    const prev=new Date(state.streak.lastDay+'T00:00:00');
    const cur=new Date(today+'T00:00:00');
    const diff=Math.round((cur-prev)/DAY);
    state.streak={count:diff===1?state.streak.count+1:1,lastDay:today};
  }
  saveState();
}
function statFor(key){
  if(!state.stats[key]) state.stats[key]={attempts:0,correct:0,wrong:0,mastery:0,exposures:0,lastAt:null,dueAt:0,lastResult:null,skills:{}};
  return state.stats[key];
}
function recordAnswer(item,ok,skill='typing'){
  const s=statFor(item.key);
  s.skills=s.skills||{};
  if(skill!=='typing'){
    const k=s.skills[skill]||(s.skills[skill]={attempts:0,correct:0,wrong:0,lastAt:null,lastResult:null});
    k.attempts++;k.lastAt=Date.now();k.lastResult=ok?'correct':'wrong';
    if(ok)k.correct++;else k.wrong++;
    s.exposures=(s.exposures||0)+1;
    updateDailyStreak();saveState();return;
  }
  s.attempts++;s.exposures=(s.exposures||0)+1;s.lastAt=Date.now();s.lastResult=ok?'correct':'wrong';
  if(ok){
    s.correct++;s.mastery=Math.min(5,(s.mastery||0)+1);
    const intervals=[0,1,2,4,7,14,30];
    s.dueAt=Date.now()+intervals[s.mastery]*DAY;
  }else{
    s.wrong++;s.mastery=Math.max(0,(s.mastery||0)-2);s.dueAt=Date.now();
  }
  updateDailyStreak();saveState();
}
function isMastered(item){const s=state.stats[item.key];return !!s&&s.mastery>=4&&s.attempts>=3;}
function isWeak(item){const s=state.stats[item.key];return !!s&&s.attempts>0&&(s.lastResult==='wrong'||s.mastery<=1||s.wrong>s.correct/2);}
function isDue(item){const s=state.stats[item.key];return !!s&&s.attempts>0&&(s.dueAt||0)<=Date.now()&&!isMastered(item);}
function progressSummary(){
  let mastered=0,learning=0,weak=0,unseen=0;
  ALL.forEach(item=>{
    const s=state.stats[item.key];
    if(!s||(!s.attempts&&!s.exposures))unseen++;
    else if(isMastered(item))mastered++;
    else{learning++;if(isWeak(item))weak++;}
  });
  return {mastered,learning,weak,unseen,total:ALL.length};
}

function resolvedSessionLength(){
  const v=state.settings.sessionLength;
  if(v==='endless') return Infinity;
  if(v==='custom') return Math.max(1,Math.min(500,Number(state.settings.customCount)||50));
  return Math.max(1,Number(v)||50);
}
function sessionLabel(){const n=resolvedSessionLength();return n===Infinity?'ENDLESS':String(n);}
function sessionNoun(noun='問'){const n=resolvedSessionLength();return n===Infinity?`ENDLESS ${noun}`:`${n}${noun}`;}

function filteredWords(){
  const s=state.settings;
  return WORDS.filter(w=>(!s.priority||w.priority===s.priority)&&(!s.category||w.category===s.category)&&(!s.mainPos||w.main_pos===s.mainPos))
    .map(w=>({...w,kind:'word',key:'w:'+w.id}));
}
function phraseItems(){return PHRASES.map(p=>({...p,kind:'phrase',word:p.phrase,main_pos:'熟語・表現',countability:'',noun_note:'',key:'p:'+p.id}));}
function adaptiveItems(n=50){
  const pool=filteredWords();
  if(n===Infinity) n=Math.min(100,pool.length);
  const weak=sample(pool.filter(isWeak),Math.ceil(n*.4));
  const used=new Set(weak.map(x=>x.key));
  const due=sample(pool.filter(x=>!used.has(x.key)&&isDue(x)),Math.ceil(n*.3));
  due.forEach(x=>used.add(x.key));
  const unseen=sample(pool.filter(x=>!used.has(x.key)&&!state.stats[x.key]?.attempts),Math.max(0,n-used.size));
  unseen.forEach(x=>used.add(x.key));
  const rest=sample(pool.filter(x=>!used.has(x.key)),Math.max(0,n-used.size));
  return shuffle([...weak,...due,...unseen,...rest]).slice(0,n);
}
function fixedRangeItems(index=0,count=10){
  // Fixed SET numbers are stable and intentionally ignore session filters.
  const pool=WORDS.map(w=>({...w,kind:'word',key:'w:'+w.id}));
  const start=Math.max(0,index)*PER_SET;
  const items=count===Infinity?pool.slice(start):pool.slice(start,start+count);
  return {items,index,totalSets:Math.ceil(pool.length/PER_SET),start,poolLength:pool.length};
}
function phraseRangeItems(index=0,count=10){
  const pool=phraseItems();
  const start=Math.max(0,index)*PER_SET;
  const items=count===Infinity?pool.slice(start):pool.slice(start,start+count);
  return {items,index,totalSets:Math.ceil(pool.length/PER_SET),start,poolLength:pool.length};
}
function reviewItems(type,n){
  const base=filteredWords();
  const pool=type==='due'?base.filter(isDue):type==='weak'?base.filter(isWeak):base;
  return n===Infinity?shuffle(pool):sample(pool,n);
}
function endlessFactory(kind){
  if(kind==='daily') return ()=>adaptiveItems(Math.min(100,filteredWords().length));
  if(kind==='random') return ()=>shuffle(filteredWords());
  if(kind==='weak') return ()=>shuffle(filteredWords().filter(isWeak));
  if(kind==='due') return ()=>shuffle(filteredWords().filter(isDue));
  if(kind==='enja') return ()=>shuffle(filteredWords());
  if(kind==='count') return ()=>shuffle(filteredWords().filter(w=>w.countability));
  return ()=>shuffle(filteredWords());
}

function damerauLevenshtein(a,b){
  a=normEnglish(a);b=normEnglish(b);
  const d=Array.from({length:a.length+1},()=>Array(b.length+1).fill(0));
  for(let i=0;i<=a.length;i++)d[i][0]=i;
  for(let j=0;j<=b.length;j++)d[0][j]=j;
  for(let i=1;i<=a.length;i++)for(let j=1;j<=b.length;j++){
    const cost=a[i-1]===b[j-1]?0:1;
    d[i][j]=Math.min(d[i-1][j]+1,d[i][j-1]+1,d[i-1][j-1]+cost);
    if(i>1&&j>1&&a[i-1]===b[j-2]&&a[i-2]===b[j-1]) d[i][j]=Math.min(d[i][j],d[i-2][j-2]+1);
  }
  return d[a.length][b.length];
}
function typoMessage(user,item){
  const distances=acceptedAnswers(item).map(a=>({a,d:damerauLevenshtein(user,a)})).sort((x,y)=>x.d-y.d);
  if(!distances.length)return '';
  const best=distances[0];
  const limit=best.a.length>=7?2:1;
  if(best.d>0&&best.d<=limit) return best.d===1?'綴りが1文字だけ違います。':`綴りがかなり近いです（${best.d}文字差）。`;
  return '';
}

function toast(msg){
  let el=document.querySelector('.toast');
  if(!el){el=document.createElement('div');el.className='toast';document.body.appendChild(el);}
  el.textContent=msg;el.classList.add('show');clearTimeout(toast.t);toast.t=setTimeout(()=>el.classList.remove('show'),1700);
}
function setRoute(route){history.replaceState(null,'','#'+route);render(route);}
function currentRoute(){return(location.hash||'#home').slice(1).split('?')[0]||'home';}
function setNav(route){document.querySelectorAll('.nav-item').forEach(b=>b.classList.toggle('active',b.dataset.route===route));}
function heroHeader(kicker,title,copy=''){return `<p class="eyebrow">${esc(kicker)}</p><h1 class="page-title">${esc(title)}</h1>${copy?`<p class="page-copy">${esc(copy)}</p>`:''}`;}
function modeCard(code,title,copy,mode){return `<button class="mode-card" data-mode="${mode}"><div class="mode-code">${esc(code)}</div><h3>${esc(title)}</h3><p>${esc(copy)}</p></button>`;}

function sessionSettingsPanel(){
  const cats=[...new Set(WORDS.map(x=>x.category).filter(Boolean))].sort();
  const poses=[...new Set(WORDS.map(x=>x.main_pos).filter(Boolean))].sort();
  const v=state.settings.sessionLength;
  return `<section class="panel session-panel">
    <div class="session-head"><div><div class="kicker">SESSION</div><div class="session-big">${esc(sessionLabel())}</div></div><div class="session-summary">${state.settings.fastMode?'FAST ON':'FAST OFF'} · ${state.settings.priority||'ALL'}${state.settings.category?' · '+esc(state.settings.category):''}</div></div>
    <div class="length-grid">
      ${['10','20','30','50'].map(n=>`<button class="length-chip ${v===n?'active':''}" data-length="${n}">${n}</button>`).join('')}
      <button class="length-chip ${v==='custom'?'active':''}" data-length="custom">CUSTOM</button>
      <button class="length-chip ${v==='endless'?'active':''}" data-length="endless">ENDLESS</button>
    </div>
    <div class="direction-row">
      <span class="direction-label">出題方向</span>
      <div class="segmented direction-segment">
        <button data-direction="ja-en" class="${state.settings.direction==='ja-en'?'active':''}">日本語 → 英語</button>
        <button data-direction="en-ja" class="${state.settings.direction==='en-ja'?'active':''}">英語 → 日本語</button>
      </div>
    </div>
    <div class="session-controls">
      <label class="field custom-count ${v==='custom'?'':'is-hidden'}">CUSTOM <input id="customCount" type="number" min="1" max="500" value="${Number(state.settings.customCount)||50}"></label>
      <label class="field">優先度<select id="sessionPriority"><option value="">ALL</option><option value="A" ${state.settings.priority==='A'?'selected':''}>A</option><option value="B" ${state.settings.priority==='B'?'selected':''}>B</option></select></label>
      <label class="field">分類<select id="sessionCategory"><option value="">ALL</option>${cats.map(x=>`<option value="${esc(x)}" ${state.settings.category===x?'selected':''}>${esc(x)}</option>`).join('')}</select></label>
      <label class="field">品詞<select id="sessionPos"><option value="">ALL</option>${poses.map(x=>`<option value="${esc(x)}" ${state.settings.mainPos===x?'selected':''}>${esc(x)}</option>`).join('')}</select></label>
      <label class="fast-toggle"><input id="fastMode" type="checkbox" ${state.settings.fastMode?'checked':''}><span>FAST</span><small>採点後に自動で次へ</small></label>
    </div>
  </section>`;
}
function bindSessionSettings(onChange=()=>renderTests()){
  document.querySelectorAll('[data-length]').forEach(btn=>btn.onclick=()=>{state.settings.sessionLength=btn.dataset.length;saveState();onChange();});
  document.querySelectorAll('[data-direction]').forEach(btn=>btn.onclick=()=>{state.settings.direction=btn.dataset.direction;saveState();onChange();});
  const custom=document.querySelector('#customCount');if(custom)custom.onchange=()=>{state.settings.customCount=Math.max(1,Math.min(500,Number(custom.value)||50));saveState();onChange();};
  const pri=document.querySelector('#sessionPriority');if(pri)pri.onchange=()=>{state.settings.priority=pri.value;state.fixedSet=0;saveState();onChange();};
  const cat=document.querySelector('#sessionCategory');if(cat)cat.onchange=()=>{state.settings.category=cat.value;state.fixedSet=0;saveState();onChange();};
  const pos=document.querySelector('#sessionPos');if(pos)pos.onchange=()=>{state.settings.mainPos=pos.value;state.fixedSet=0;saveState();onChange();};
  const fast=document.querySelector('#fastMode');if(fast)fast.onchange=()=>{state.settings.fastMode=fast.checked;saveState();onChange();};
}

function renderHome(){
  setNav('home');
  const p=progressSummary();const percent=p.total?Math.round(p.mastered/p.total*100):0;const due=ALL.filter(isDue).length;
  const display=sessionLabel();
  main.innerHTML=`
    ${heroHeader('EIKEN GRADE 4','Vocabulary Lab','語彙を短いセットでも、長い流れでも学習できます。')}
    <section class="hero-grid">
      <div class="hero-card primary">
        <div><div class="kicker">TODAY / ${esc(recallLabel().toUpperCase())} ${esc(display)}</div><div class="hero-number">${display==='ENDLESS'?'∞':esc(display)}</div><div class="hero-title">今日のセッション</div><div class="hero-sub muted">弱点・復習期限・未学習を混ぜて出題します。</div></div>
        <div class="btn-row"><button class="btn inverse" id="startDaily">はじめる →</button><button class="btn ghost" style="color:#fff;border-color:#444" data-route="tests">設定</button></div>
      </div>
      <div class="hero-card">
        <div><div class="kicker">PROGRESS</div><div class="hero-number">${percent}<span style="font-size:.35em">%</span></div><div class="hero-title">${p.mastered} / ${p.total} 定着</div><div class="hero-sub">${due}項目が復習タイミングです。連続学習 ${state.streak.count}日。</div><div class="progress-mini"><span style="width:${percent}%"></span></div></div>
        <div class="btn-row"><button class="btn" data-route="progress">進捗を見る</button></div>
      </div>
    </section>
    <section class="grid-4"><div class="stat-card"><div class="stat-value">${p.unseen}</div><div class="stat-label">未学習</div></div><div class="stat-card"><div class="stat-value">${p.learning}</div><div class="stat-label">学習中</div></div><div class="stat-card"><div class="stat-value">${p.weak}</div><div class="stat-label">弱点</div></div><div class="stat-card"><div class="stat-value">${state.streak.count}</div><div class="stat-label">連続学習日</div></div></section>
    <div class="section-head"><div><h2>学習メニュー</h2><p>現在のセッション：${esc(sessionNoun())}</p></div></div>
    <section class="mode-grid">
      ${modeCard('STUDY','学習カード',`${sessionNoun('語')}を連続で確認します。`,'study')}
      ${modeCard('FIXED','固定セット','SET番号を起点に、設定した語数だけ続けます。','fixed')}
      ${modeCard('REVIEW','弱点復習','誤答・低定着の語を優先して再出題します。','weak')}
      ${modeCard('MEANING','意味選択','英単語を見て、日本語の意味を4択で選びます。','enja')}
      ${modeCard('C / U','名詞の可算性','C / U / C-U などを別スキルとして確認します。','count')}
      ${modeCard('PHRASE','熟語・表現','熟語・表現を連続で確認します。','phrases')}
    </section>
    <div class="section-head"><div><h2>データ</h2><p>${DATA.meta.wordCount||WORDS.length} words + ${DATA.meta.phraseCount||PHRASES.length} phrases</p></div></div>
    <section class="panel"><div class="btn-row" style="margin-top:0"><a class="btn" href="./downloads/eiken4_vocabulary.xlsx" download>生徒用Excel</a><a class="btn" href="./source/eiken4_learning_master.xlsx" download>教材マスター</a><button class="btn" id="exportProgress">学習履歴を書き出す</button></div><div class="callout">教材データはExcelを原本とし、Web用データはビルド時に生成します。</div></section>`;
  document.querySelector('#startDaily').onclick=()=>startMode('daily');
  document.querySelector('#exportProgress').onclick=exportProgress;
}

function renderTests(){
  setNav('tests');
  const n=resolvedSessionLength();
  const fixed=fixedRangeItems(state.fixedSet,n);
  const phrase=phraseRangeItems(state.phraseSet,n);
  main.innerHTML=`
    ${heroHeader('TEST MODES','Session','出題数と範囲を決めてから、学習モードを選びます。')}
    ${sessionSettingsPanel()}
    <div class="section-head"><div><h2>単語</h2><p>${filteredWords().length} words in range</p></div></div>
    <section class="mode-grid">
      ${modeCard('SMART',`今日の${sessionNoun()}`,'選択中の出題方向で、弱点・復習期限・未学習を混ぜます。','daily')}
      ${modeCard('RANDOM',`ランダム${sessionNoun()}`,'選択中の出題方向で、指定範囲から出題します。','random')}
      ${modeCard('MEANING','意味選択','英単語を見て、日本語の意味を4択で選びます。','enja')}
      ${modeCard('C / U','可算性','名詞区分を4択で答えます。','count')}
      ${modeCard('STUDY','学習カード','テスト前に同じ設定語数を確認します。','study')}
    </section>
    <div class="section-head"><div><h2>固定セット</h2><p>SET ${String(fixed.index+1).padStart(2,'0')} / ${fixed.totalSets}</p></div></div>
    <section class="panel"><div class="filters"><select id="fixedSet" class="select"></select><button class="btn dark" id="startFixed">${n===Infinity?'最後まで':fixed.items.length+'語'}をテスト</button><button class="btn" id="studyFixed">先に覚える</button></div><div class="range-note">固定SETは範囲フィルタの影響を受けません。開始SETから${n===Infinity?'データ末尾まで':`最大${n}語`}を連続で扱います。</div><div id="fixedPreview" class="word-list"></div></section>
    <div class="section-head"><div><h2>熟語・表現</h2><p>SET ${String(phrase.index+1).padStart(2,'0')} / ${phrase.totalSets}</p></div></div>
    <section class="panel"><div class="filters"><select id="phraseSet" class="select"></select><button class="btn dark" id="startPhrase">${n===Infinity?'最後まで':phrase.items.length+'表現'}をテスト</button></div><div id="phrasePreview" class="word-list"></div></section>`;
  bindSessionSettings(()=>renderTests());
  setupFixedControls();setupPhraseControls();
}
function setupFixedControls(){
  const setEl=document.querySelector('#fixedSet');
  const n=resolvedSessionLength();
  const total=Math.max(1,Math.ceil(WORDS.length/PER_SET));
  const current=Math.min(state.fixedSet,total-1);
  setEl.innerHTML=Array.from({length:total},(_,i)=>`<option value="${i}" ${i===current?'selected':''}>SET ${String(i+1).padStart(2,'0')}</option>`).join('');
  function preview(){
    const res=fixedRangeItems(Number(setEl.value||0),n);
    const shown=res.items.slice(0,10);
    document.querySelector('#fixedPreview').innerHTML=shown.map(simpleRow).join('')+(res.items.length>10?`<div class="range-note">＋ ${res.items.length-10}語</div>`:'');
  }
  setEl.onchange=()=>{state.fixedSet=Number(setEl.value);saveState();preview();};
  document.querySelector('#startFixed').onclick=()=>{
    const res=fixedRangeItems(Number(setEl.value),n);
    startQuiz(recallMode(),res.items,{title:`SET ${String(res.index+1).padStart(2,'0')} →`,source:'fixed',setIndex:res.index,itemCount:res.items.length});
  };
  document.querySelector('#studyFixed').onclick=()=>{const res=fixedRangeItems(Number(setEl.value),n);startStudy(res.items,{title:`SET ${String(res.index+1).padStart(2,'0')} →`});};
  preview();
}
function setupPhraseControls(){
  const setEl=document.querySelector('#phraseSet');
  const n=resolvedSessionLength();
  const total=Math.max(1,Math.ceil(PHRASES.length/PER_SET));
  const current=Math.min(state.phraseSet,total-1);
  setEl.innerHTML=Array.from({length:total},(_,i)=>`<option value="${i}" ${i===current?'selected':''}>SET ${String(i+1).padStart(2,'0')}</option>`).join('');
  function preview(){const res=phraseRangeItems(Number(setEl.value||0),n);document.querySelector('#phrasePreview').innerHTML=res.items.slice(0,10).map(simpleRow).join('')+(res.items.length>10?`<div class="range-note">＋ ${res.items.length-10}表現</div>`:'');}
  setEl.onchange=()=>{state.phraseSet=Number(setEl.value);saveState();preview();};
  document.querySelector('#startPhrase').onclick=()=>{const res=phraseRangeItems(Number(setEl.value),n);startQuiz('typing',res.items,{title:`熟語 SET ${String(res.index+1).padStart(2,'0')} →`,source:'phrases',setIndex:res.index,itemCount:res.items.length});};
  preview();
}
function simpleRow(x){return `<div class="word-row"><div><div class="word-en">${esc(x.word)}</div>${x.ipa_us?`<div class="ipa">${esc(x.ipa_us)}</div>`:''}<div class="badges">${x.priority?`<span class="badge">${esc(x.priority)}</span>`:''}${x.main_pos?`<span class="badge">${esc(x.main_pos)}</span>`:''}</div></div><div class="word-ja">${esc(x.meaning)}</div><div></div></div>`;}

function renderReview(){
  setNav('review');const weak=filteredWords().filter(isWeak);const due=filteredWords().filter(isDue);
  main.innerHTML=`${heroHeader('REVIEW','弱点復習','現在のセッション設定を使って復習します。')}${sessionSettingsPanel()}
    <section class="grid-4"><div class="stat-card"><div class="stat-value">${weak.length}</div><div class="stat-label">弱点</div></div><div class="stat-card"><div class="stat-value">${due.length}</div><div class="stat-label">復習期限</div></div><div class="stat-card"><div class="stat-value">${ALL.filter(isMastered).length}</div><div class="stat-label">定着</div></div><div class="stat-card"><div class="stat-value">${state.streak.count}</div><div class="stat-label">連続学習日</div></div></section>
    <div class="section-head"><div><h2>復習を始める</h2><p>${esc(sessionNoun())}</p></div></div><section class="mode-grid">${modeCard('WEAK','弱点','直近の誤答・低定着語から出題します。','weak')}${modeCard('DUE','今日の復習','復習期限を迎えた語から出題します。','due')}${modeCard('SMART','混合','弱点・期限・未学習を混ぜます。','daily')}</section>
    <div class="section-head"><div><h2>弱点一覧</h2><p>${weak.length} items</p></div></div><section class="panel">${weak.length?weak.slice(0,80).map(simpleRow).join(''):`<div class="empty">まだ弱点データがありません。</div>`}</section>`;
  bindSessionSettings(()=>renderReview());
}

function renderList(){
  setNav('list');listLimit=120;
  const levels=[...new Set(ALL.map(x=>x.level).filter(Boolean))].sort();
  const poses=[...new Set(WORDS.map(x=>x.main_pos).filter(Boolean))].sort();
  main.innerHTML=`${heroHeader('DATABASE','単語一覧','検索に加えて、レベル・品詞・優先度から絞り込めます。')}<div class="list-toolbar"><div class="filters list-filters"><input class="input" id="searchInput" type="search" placeholder="英単語・日本語・分類で検索"><select class="select" id="kindFilter"><option value="word">単語</option><option value="phrase">熟語・表現</option><option value="">すべて</option></select><select class="select" id="levelFilter"><option value="">レベルすべて</option>${levels.map(x=>`<option value="${esc(x)}">英検${esc(x)}級</option>`).join('')}</select><select class="select" id="posFilter"><option value="">品詞すべて</option>${poses.map(x=>`<option value="${esc(x)}">${esc(x)}</option>`).join('')}</select><select class="select" id="priorityFilter"><option value="">優先度すべて</option><option value="A">A</option><option value="B">B</option></select></div></div><div id="listCount" class="kicker"></div><section class="word-list" id="wordList"></section><div class="btn-row"><button class="btn" id="loadMore">さらに表示</button></div>`;
  ['searchInput','kindFilter','levelFilter','posFilter','priorityFilter'].forEach(id=>document.querySelector('#'+id).addEventListener('input',()=>{listLimit=120;drawList();}));
  document.querySelector('#loadMore').onclick=()=>{listLimit+=120;drawList();};drawList();
}
function drawList(){
  const q=document.querySelector('#searchInput').value.trim().toLowerCase();
  const kind=document.querySelector('#kindFilter').value;
  const level=document.querySelector('#levelFilter').value;
  const pos=document.querySelector('#posFilter').value;
  const pri=document.querySelector('#priorityFilter').value;
  const rows=ALL.filter(x=>{const hay=`${x.word} ${x.meaning} ${x.category||''} ${x.main_pos||''} ${x.noun_note||''} ${x.ipa_us||''}`.toLowerCase();return(!q||hay.includes(q))&&(!kind||x.kind===kind)&&(!level||String(x.level)===level)&&(!pos||x.main_pos===pos)&&(!pri||x.priority===pri);});
  document.querySelector('#listCount').textContent=`${rows.length} ITEMS`;document.querySelector('#wordList').innerHTML=rows.slice(0,listLimit).map(fullRow).join('');document.querySelector('#loadMore').hidden=listLimit>=rows.length;
}
function fullRow(x){
  return `<article class="word-row"><div><div class="word-en">${esc(x.word)}</div>${x.ipa_us?`<div class="ipa">${esc(x.ipa_us)}</div>`:''}<div class="badges">${x.level?`<span class="badge">LEVEL ${esc(x.level)}</span>`:''}${x.priority?`<span class="badge">優先度 ${esc(x.priority)}</span>`:''}${x.main_pos?`<span class="badge">${esc(x.main_pos)}</span>`:''}${x.countability?`<span class="badge">${esc(x.countability)}</span>`:''}${isMastered(x)?`<span class="badge">定着</span>`:isWeak(x)?`<span class="badge">弱点</span>`:''}</div></div><div><div class="word-ja">${esc(x.meaning)}</div>${x.example?`<div class="word-note">${esc(x.example)}</div>`:''}${x.noun_note?`<div class="word-note">${esc(x.noun_note)}</div>`:''}${x.collocation?`<div class="word-note">Collocation: ${esc(x.collocation)}</div>`:''}</div><div>${x.reference?`<a class="source-link" href="${esc(x.reference)}" target="_blank" rel="noopener">参照↗</a>`:''}</div></article>`;
}

function masteryData(items){
  const total=items.length||1;
  const mastered=items.filter(isMastered).length;
  const weak=items.filter(isWeak).length;
  const seen=items.filter(x=>{const s=state.stats[x.key];return s&&(s.attempts||s.exposures);}).length;
  return {total:items.length,mastered,weak,seen,pct:Math.round(mastered/total*100)};
}
function skillAccuracy(skill){
  let correct=0,attempts=0;
  Object.values(state.stats).forEach(s=>{const k=s.skills?.[skill];if(k){correct+=k.correct||0;attempts+=k.attempts||0;}});
  return {correct,attempts,pct:attempts?Math.round(correct/attempts*100):0};
}
function posProgress(){
  return [...new Set(WORDS.map(w=>w.main_pos).filter(Boolean))].map(pos=>{
    const raw=WORDS.filter(w=>w.main_pos===pos);
    const items=raw.map(w=>({...w,kind:'word',key:'w:'+w.id}));
    const base=masteryData(items);
    const categories=[...new Set(raw.map(w=>w.category).filter(Boolean))].map(cat=>{
      const ci=raw.filter(w=>w.category===cat).map(w=>({...w,kind:'word',key:'w:'+w.id}));
      return {name:cat,...masteryData(ci)};
    }).sort((a,b)=>b.total-a.total);
    return {pos,...base,categories};
  }).sort((a,b)=>b.total-a.total);
}
function renderProgress(){
  setNav('progress');const p=progressSummary();const percent=p.total?Math.round(p.mastered/p.total*100):0;
  const posData=posProgress();const meaning=skillAccuracy('enja');const count=skillAccuracy('count');const recent=[...state.history].slice(-12);
  main.innerHTML=`${heroHeader('PROGRESS','学習進捗','総合状態 → 品詞 → 詳細分類の順で確認できます。')}
    <section class="progress-overview panel">
      <div class="donut-wrap"><div class="donut" style="--pct:${percent}"><div><strong>${percent}%</strong><span>想起定着</span></div></div></div>
      <div class="progress-legend"><div><span class="legend-dot mastered"></span><b>${p.mastered}</b><small>定着</small></div><div><span class="legend-dot learning"></span><b>${p.learning}</b><small>学習中</small></div><div><span class="legend-dot unseen"></span><b>${p.unseen}</b><small>未学習</small></div></div>
    </section>
    <section class="grid-4"><div class="stat-card"><div class="stat-value">${percent}%</div><div class="stat-label">綴り想起</div></div><div class="stat-card"><div class="stat-value">${meaning.pct}%</div><div class="stat-label">意味選択 正答率</div></div><div class="stat-card"><div class="stat-value">${count.pct}%</div><div class="stat-label">可算性 正答率</div></div><div class="stat-card"><div class="stat-value">${state.streak.count}</div><div class="stat-label">連続学習日</div></div></section>
    <div class="section-head"><div><h2>最近のセッション</h2><p>正答率</p></div></div>
    <section class="panel"><div class="score-chart">${recent.length?recent.map((h,i)=>{const pct=h.total?Math.round(h.score/h.total*100):0;return `<div class="score-column" title="${esc(h.title)} ${pct}%"><div class="score-value">${pct}</div><div class="score-bar"><span style="height:${pct}%"></span></div><small>${i+1}</small></div>`;}).join(''):`<div class="empty">まだセッション履歴がありません。</div>`}</div></section>
    <div class="section-head"><div><h2>品詞別</h2><p>開くと詳細分類を確認できます</p></div></div>
    <section class="pos-progress">${posData.map(g=>`<details class="pos-group"><summary><div class="pos-title"><b>${esc(g.pos)}</b><small>${g.mastered}/${g.total} 定着</small></div><div class="pos-bar"><span style="width:${g.pct}%"></span></div><strong>${g.pct}%</strong></summary><div class="pos-subgroups">${g.categories.map(c=>`<div class="subgroup-row"><span>${esc(c.name)}</span><div class="category-bar"><span style="width:${c.pct}%"></span></div><small>${c.mastered}/${c.total}</small></div>`).join('')}</div></details>`).join('')}</section>
    <div class="section-head"><div><h2>履歴</h2><p>${state.history.length} sessions</p></div></div><section class="panel history-list">${state.history.length?[...state.history].reverse().slice(0,14).map(h=>`<div class="history-row"><div><div class="history-title">${esc(h.title)}${h.partial?' · 途中終了':''}</div><div class="history-meta">${esc(h.day)} · ${esc(h.mode)} · ${h.total}問</div></div><div class="history-score">${h.score}/${h.total}</div></div>`).join(''):`<div class="empty">まだ履歴がありません。</div>`}</section>
    <div class="section-head"><div><h2>データ管理</h2><p>端末内保存</p></div></div><section class="panel"><div class="btn-row" style="margin-top:0"><button class="btn" id="exportProgress">履歴を書き出す</button><label class="btn">履歴を読み込む<input id="importProgress" type="file" accept="application/json" hidden></label><button class="btn" id="resetProgress">履歴をリセット</button></div><div class="callout">学習履歴はブラウザのlocalStorageに保存されます。別端末へは自動同期されません。</div></section>`;
  document.querySelector('#exportProgress').onclick=exportProgress;document.querySelector('#importProgress').onchange=importProgress;document.querySelector('#resetProgress').onclick=resetProgress;
}

function startStudy(items,meta={}){
  if(!items.length){toast('対象の項目がありません');return;}
  quiz={mode:'study',items:[...items],index:0,revealed:false,meta,startAt:Date.now()};renderStudy();
}
function renderStudy(){
  setNav('');const q=quiz,item=q.items[q.index];
  main.innerHTML=`<div class="quiz-shell"><div class="quiz-top"><div><div class="quiz-set">STUDY · ${esc(q.meta.title||'SESSION')}</div><div class="quiz-count">${q.index+1} / ${q.items.length}</div></div><button class="btn" id="quitStudy">終了</button></div><div class="progress-track"><span style="width:${(q.index/q.items.length)*100}%"></span></div><section class="quiz-card study-card ${q.revealed?'revealed':''}" id="studyCard"><div class="question-type">${q.revealed?'MEANING':'TAP TO REVEAL'}</div><div class="study-word">${esc(item.word)}</div>${item.ipa_us?`<div class="ipa large">${esc(item.ipa_us)}</div>`:''}${q.revealed?`<div class="study-meaning">${esc(item.meaning)}</div><div class="study-detail">${[item.main_pos,item.category,item.countability].filter(Boolean).map(esc).join(' · ')}${item.example?`<br>${esc(item.example)}`:''}</div><div class="swipe-hint">← まだ　　スワイプ　　覚えた →</div>`:`<div class="study-hint">カードをタップして意味を確認</div>`}</section>${q.revealed?`<div class="study-rate-actions"><button class="btn" id="studyNo">← まだ</button><button class="btn dark" id="studyYes">覚えた →</button></div>`:''}</div>`;
  const card=document.querySelector('#studyCard');let startX=0,startY=0,moved=false;
  card.addEventListener('pointerdown',e=>{startX=e.clientX;startY=e.clientY;moved=false;card.setPointerCapture?.(e.pointerId);});
  card.addEventListener('pointermove',e=>{if(Math.abs(e.clientX-startX)>8||Math.abs(e.clientY-startY)>8)moved=true;});
  card.addEventListener('pointerup',e=>{const dx=e.clientX-startX,dy=e.clientY-startY;if(q.revealed&&Math.abs(dx)>55&&Math.abs(dx)>Math.abs(dy)){card.classList.add(dx>0?'swipe-right':'swipe-left');setTimeout(()=>studyRate(item,dx>0),120);return;}if(!q.revealed&&!moved){q.revealed=true;renderStudy();}});
  document.querySelector('#studyYes')?.addEventListener('click',()=>studyRate(item,true));document.querySelector('#studyNo')?.addEventListener('click',()=>studyRate(item,false));document.querySelector('#quitStudy').onclick=()=>setRoute('home');
}
function studyRate(item,known){
  const s=statFor(item.key);s.exposures=(s.exposures||0)+1;s.selfKnown=!!known;if(!known)s.dueAt=Date.now();updateDailyStreak();saveState();quiz.index++;quiz.revealed=false;if(quiz.index>=quiz.items.length){toast('学習カードを完了しました');setRoute('tests');}else renderStudy();
}

function startQuiz(mode,items,meta={},options={}){
  if(!items||!items.length){toast('対象の項目がありません');return;}
  clearQuizTimer();
  quiz={mode,items:[...items],index:0,answers:[],locked:false,meta,startAt:Date.now(),partial:false,endless:!!options.endless,sourceFactory:options.sourceFactory||null,fastMode:state.settings.fastMode,autoTimer:null};
  renderQuiz();
}
function clearQuizTimer(){if(quiz?.autoTimer){clearTimeout(quiz.autoTimer);quiz.autoTimer=null;}}
function renderQuiz(){
  clearQuizTimer();setNav('');const q=quiz,item=q.items[q.index];if(!item){finishQuiz(false);return;}
  const endless=q.endless;const total=endless?'∞':q.items.length;const progress=endless?0:(q.index/q.items.length)*100;const isTyping=q.mode==='typing';
  const questionTitle=q.mode==='typing'?(item.kind==='phrase'?'日本語 → 英語表現':'綴り入力｜日本語 → 英語'):q.mode==='enja'?'意味選択｜英語 → 日本語':'名詞区分';
  main.innerHTML=`<div class="quiz-shell"><div class="quiz-top"><div><div class="quiz-set">${esc(q.meta.title||'SESSION')}${q.fastMode?' · FAST':''}</div><div class="quiz-count">${q.index+1} / ${total}</div></div><button class="btn" id="quitQuiz">終了して保存</button></div>${endless?`<div class="endless-line">ENDLESS · 終了ボタンまで継続</div>`:`<div class="progress-track"><span style="width:${progress}%"></span></div>`}<section class="quiz-card"><div class="question-type">${questionTitle}</div><div class="question-main">${esc(q.mode==='typing'?item.meaning:item.word)}</div><div class="question-meta">${q.mode==='typing'?[item.main_pos,item.category,item.countability].filter(Boolean).map(esc).join(' · '):q.mode==='count'?esc(item.meaning):''}</div>${isTyping?`<input class="answer-input" id="answerInput" type="text" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="${item.kind==='phrase'?'英語表現を入力':'英単語を入力'}">`:`<div class="choice-grid" id="choiceGrid">${makeChoices(item,q.mode).map(c=>`<button class="choice" data-value="${esc(c.value)}">${esc(c.label)}</button>`).join('')}</div>`}<div class="feedback" id="feedback"></div><div class="quiz-actions">${isTyping?`<button class="btn dark" id="checkAnswer" disabled>採点する</button>`:''}<button class="btn" id="showAnswer">わからない／答えを見る</button><button class="btn dark" id="nextQuestion" hidden>${endless?'次の問題':q.index===q.items.length-1?'結果を見る':'次の問題'}</button></div></section></div>`;
  document.querySelector('#quitQuiz').onclick=()=>{clearQuizTimer();if(q.answers.length)finishQuiz(true);else setRoute('home');};
  if(isTyping){
    const input=document.querySelector('#answerInput'),check=document.querySelector('#checkAnswer');setTimeout(()=>input.focus(),30);
    input.addEventListener('input',()=>{check.disabled=!input.value.trim();});
    check.onclick=()=>gradeTyping(item);
    input.onkeydown=e=>{if(e.key==='Enter'){if(!q.locked&&input.value.trim())gradeTyping(item);else if(q.locked){clearQuizTimer();nextQuestion();}}};
  }else document.querySelectorAll('.choice').forEach(btn=>btn.onclick=()=>gradeChoice(item,btn.dataset.value));
  document.querySelector('#showAnswer').onclick=()=>gradeUnknown(item);
  document.querySelector('#nextQuestion').onclick=()=>{clearQuizTimer();nextQuestion();};
}
function makeChoices(item,mode){
  if(mode==='enja'){
    const source=item.kind==='phrase'?phraseItems():WORDS.map(w=>({...w,kind:'word',key:'w:'+w.id}));const candidates=source.filter(x=>x.key!==item.key&&x.meaning!==item.meaning);const same=candidates.filter(x=>(x.main_pos||'')===(item.main_pos||'')||(x.category||'')===(item.category||''));const distract=sample(same.length>=3?same:candidates,3).map(x=>({value:x.meaning,label:x.meaning}));return shuffle([{value:item.meaning,label:item.meaning},...distract]);
  }
  const values=[...new Set(WORDS.map(x=>x.countability).filter(Boolean))];const distract=sample(values.filter(x=>x!==item.countability),3).map(x=>({value:x,label:countLabel(x)}));return shuffle([{value:item.countability,label:countLabel(item.countability)},...distract]);
}
function countLabel(v){const map={'C':'Countable (C) — 可算名詞','U':'Uncountable (U) — 不可算名詞','C/U':'Countable / Uncountable (C/U) — 両用','PN':'Proper noun (PN) — 固有名詞','PL':'Plural (PL) — 複数形','PL-only':'Plural only (PL-only) — 複数専用','C（単複同形）':'Countable, same singular/plural — 単複同形','時の表現':'Time expression — 時の表現','特殊':'Special — 特殊'};return map[v]||v;}
function gradeTyping(item){
  const input=document.querySelector('#answerInput');const user=input.value;if(!user.trim())return;const answers=acceptedAnswers(item);const nu=normEnglish(user);const ok=answers.some(a=>normEnglish(a)===nu);grade(item,ok,user,answers.join(' / '),ok?'':typoMessage(user,item));
}
function gradeChoice(item,value){const correct=quiz.mode==='enja'?item.meaning:item.countability;const ok=value===correct;document.querySelectorAll('.choice').forEach(b=>b.disabled=true);grade(item,ok,value,quiz.mode==='count'?countLabel(correct):correct,'');}
function gradeUnknown(item){
  if(quiz.locked)return;
  document.querySelectorAll('.choice').forEach(b=>b.disabled=true);
  const correct=quiz.mode==='typing'?acceptedAnswers(item).join(' / '):quiz.mode==='enja'?item.meaning:countLabel(item.countability);
  grade(item,false,'未回答',correct,'答えを確認しました');
}
function grade(item,ok,user,correct,note=''){
  if(quiz.locked)return;quiz.locked=true;quiz.answers.push({item,ok,user,correct,note});recordAnswer(item,ok,quiz.mode);document.querySelector('#answerInput')?.setAttribute('disabled','');const check=document.querySelector('#checkAnswer');if(check)check.hidden=true;const show=document.querySelector('#showAnswer');if(show)show.hidden=true;const fb=document.querySelector('#feedback');fb.className='feedback show '+(ok?'good':'bad');fb.innerHTML=ok?`○ 正解<strong>${esc(item.word)}</strong>`:`× 不正解<strong>${esc(correct)}</strong>${note?`<div class="typo-note">${esc(note)}</div>`:''}`;document.querySelector('#nextQuestion').hidden=false;
  if(quiz.fastMode){const wait=ok?500:1250;quiz.autoTimer=setTimeout(()=>nextQuestion(),wait);}
}
function nextQuestion(){
  clearQuizTimer();quiz.index++;quiz.locked=false;
  if(quiz.endless&&quiz.index>=quiz.items.length){const next=quiz.sourceFactory?quiz.sourceFactory():[];if(!next.length){finishQuiz(false);return;}quiz.items.push(...next);}
  if(!quiz.endless&&quiz.index>=quiz.items.length)finishQuiz(false);else renderQuiz();
}
function finishQuiz(partial=false){
  clearQuizTimer();const q=quiz;if(!q)return;const total=q.answers.length;const score=q.answers.filter(a=>a.ok).length;if(!total){setRoute('home');return;}
  state.history.push({day:localDay(),title:q.meta.title||'Session',mode:q.mode,score,total,partial:!!partial,durationSec:Math.round((Date.now()-q.startAt)/1000)});if(state.history.length>200)state.history=state.history.slice(-200);
  const ratio=score/total;
  if(!partial&&q.meta.source==='fixed'&&ratio>=.8)state.fixedSet=(q.meta.setIndex||0)+Math.max(1,Math.ceil(total/PER_SET));
  if(!partial&&q.meta.source==='phrases'&&ratio>=.8)state.phraseSet=(q.meta.setIndex||0)+Math.max(1,Math.ceil(total/PER_SET));
  saveState();renderResult(score,partial);
}
function renderResult(score,partial=false){
  setNav('');const q=quiz;const wrong=q.answers.filter(a=>!a.ok);const total=q.answers.length;
  main.innerHTML=`<div class="quiz-shell"><p class="eyebrow">${partial?'SESSION SAVED':'RESULT'}</p><div class="result-score">${score}<span style="font-size:.35em"> / ${total}</span></div><div class="result-label">${partial?`途中終了：${total}問の結果を保存しました。`:score===total?'全問正解。':`${wrong.length}項目を復習候補に登録しました。`}</div><div class="btn-row">${wrong.length?`<button class="btn red" id="retryWrong">間違いだけ再テスト</button>`:''}${q.meta.source==='fixed'&&!partial?`<button class="btn dark" id="nextFixed">続きから</button>`:''}${q.meta.source==='phrases'&&!partial?`<button class="btn dark" id="nextPhrase">続きから</button>`:''}<button class="btn" data-route="home">ホームへ</button></div><section class="result-list">${q.answers.map(a=>`<div class="result-row"><div class="result-mark ${a.ok?'ok':'ng'}">${a.ok?'○':'×'}</div><div><div class="result-word">${esc(a.item.word)}</div><div class="result-meaning">${esc(a.item.meaning)}${a.note?` · ${esc(a.note)}`:''}</div></div><div class="badge">${esc(a.user)}</div></div>`).join('')}</section></div>`;
  document.querySelector('#retryWrong')?.addEventListener('click',()=>startQuiz(q.mode,wrong.map(x=>x.item),{title:'間違い復習',source:'review'}));
  document.querySelector('#nextFixed')?.addEventListener('click',()=>{const n=resolvedSessionLength();const next=fixedRangeItems(state.fixedSet,n);startQuiz(recallMode(),next.items,{title:`SET ${String(next.index+1).padStart(2,'0')} →`,source:'fixed',setIndex:next.index,itemCount:next.items.length});});
  document.querySelector('#nextPhrase')?.addEventListener('click',()=>{const n=resolvedSessionLength();const next=phraseRangeItems(state.phraseSet,n);startQuiz('typing',next.items,{title:`熟語 SET ${String(next.index+1).padStart(2,'0')} →`,source:'phrases',setIndex:next.index,itemCount:next.items.length});});
  bindCommon();
}

function exportProgress(){const blob=new Blob([JSON.stringify({exportedAt:new Date().toISOString(),appVersion:2,state},null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='eiken-vocab-progress.json';a.click();URL.revokeObjectURL(a.href);}
function importProgress(e){const file=e.target.files?.[0];if(!file)return;const reader=new FileReader();reader.onload=()=>{try{const parsed=JSON.parse(reader.result);if(!parsed.state)throw new Error();const d=defaultState();state={...d,...parsed.state,version:2,settings:{...d.settings,...(parsed.state.settings||{})},streak:{...d.streak,...(parsed.state.streak||{})}};saveState();toast('学習履歴を読み込みました');renderProgress();}catch(err){toast('履歴ファイルを読み込めませんでした');}};reader.readAsText(file);}
function resetProgress(){if(!confirm('この端末の学習履歴をすべて削除しますか？'))return;state=defaultState();saveState();toast('学習履歴をリセットしました');renderProgress();}

function startMode(mode){
  const n=resolvedSessionLength();const endless=n===Infinity;
  if(mode==='daily'){
    const qm=recallMode();const items=adaptiveItems(endless?Math.min(100,filteredWords().length):n);startQuiz(qm,items,{title:`SMART ${sessionLabel()}`,source:'daily'},{endless,sourceFactory:endless?endlessFactory(qm==='enja'?'enja':'daily'):null});
  }
  if(mode==='random'){
    const qm=recallMode();const pool=filteredWords();const items=endless?shuffle(pool):sample(pool,n);startQuiz(qm,items,{title:`RANDOM ${sessionLabel()}`,source:'random'},{endless,sourceFactory:endless?endlessFactory(qm==='enja'?'enja':'random'):null});
  }
  if(mode==='weak'){
    const qm=recallMode();const items=reviewItems('weak',n);if(items.length)startQuiz(qm,items,{title:`WEAK ${sessionLabel()}`,source:'review'},{endless,sourceFactory:endless?endlessFactory(qm==='enja'?'enja':'weak'):null});else toast('弱点データがまだありません');
  }
  if(mode==='due'){
    const qm=recallMode();const items=reviewItems('due',n);if(items.length)startQuiz(qm,items,{title:`DUE ${sessionLabel()}`,source:'review'},{endless,sourceFactory:endless?endlessFactory(qm==='enja'?'enja':'due'):null});else toast('今日の復習項目はありません');
  }
  if(mode==='enja'){
    const pool=filteredWords();const items=endless?shuffle(pool):sample(pool,n);startQuiz('enja',items,{title:`E → J ${sessionLabel()}`,source:'random'},{endless,sourceFactory:endless?endlessFactory('enja'):null});
  }
  if(mode==='count'){
    const pool=filteredWords().filter(w=>w.countability);const items=endless?shuffle(pool):sample(pool,n);startQuiz('count',items,{title:`C / U ${sessionLabel()}`,source:'random'},{endless,sourceFactory:endless?endlessFactory('count'):null});
  }
  if(mode==='phrases'){
    const res=phraseRangeItems(state.phraseSet,n);startQuiz('typing',res.items,{title:`熟語 SET ${String(res.index+1).padStart(2,'0')} →`,source:'phrases',setIndex:res.index,itemCount:res.items.length});
  }
  if(mode==='fixed')setRoute('tests');
  if(mode==='study'){
    const items=adaptiveItems(endless?Math.min(100,filteredWords().length):n);startStudy(items,{title:`STUDY ${endless?'100':sessionLabel()}`});
  }
}

function render(route=currentRoute()){
  window.scrollTo(0,0);
  if(route==='home')renderHome();else if(route==='tests')renderTests();else if(route==='review')renderReview();else if(route==='list')renderList();else if(route==='progress')renderProgress();else renderHome();
  bindCommon();
}
function bindCommon(){
  document.querySelectorAll('[data-route]').forEach(el=>el.onclick=()=>setRoute(el.dataset.route));
  document.querySelectorAll('[data-mode]').forEach(el=>el.onclick=()=>startMode(el.dataset.mode));
}
window.addEventListener('hashchange',()=>render(currentRoute()));
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferredInstallPrompt=e;document.querySelector('#installBtn').hidden=false;});
document.querySelector('#installBtn').onclick=async()=>{if(!deferredInstallPrompt)return;deferredInstallPrompt.prompt();await deferredInstallPrompt.userChoice;deferredInstallPrompt=null;document.querySelector('#installBtn').hidden=true;};
document.querySelector('#themeBtn').onclick=toggleTheme;
if(window.matchMedia)window.matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change',()=>{if(state.settings.theme==='system')applyTheme();});
if('serviceWorker'in navigator)window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(()=>{}));
applyTheme();
render(currentRoute());
})();

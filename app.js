
(() => {
'use strict';

const DATA = window.EIKEN4_DATA;
const WORDS = DATA.words;
const PHRASES = DATA.phrases;
const ALL = [
  ...WORDS.map(x => ({...x, kind:'word', key:'w:'+x.id})),
  ...PHRASES.map(x => ({...x, kind:'phrase', word:x.phrase, main_pos:'熟語・表現', countability:'', noun_note:'', key:'p:'+x.id}))
];
const ITEM_MAP = new Map(ALL.map(x => [x.key, x]));
const STORAGE_KEY = 'eiken4-vocab-lab-v1';
const PER_SET = 10;
const DAY = 86400000;

let state = loadState();
let quiz = null;
let deferredInstallPrompt = null;
let listLimit = 120;

const main = document.querySelector('#main');

function defaultState(){
  return {
    version:1,
    stats:{},
    history:[],
    fixedSet:0,
    phraseSet:0,
    streak:{count:0,lastDay:null},
    settings:{priority:'A',questionCount:10},
    studyKnown:{}
  };
}
function loadState(){
  try{
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return {...defaultState(), ...(parsed || {})};
  }catch(e){ return defaultState(); }
}
function saveState(){
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}
function esc(v){
  return String(v ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
}
function normEnglish(v){
  return String(v ?? '')
    .toLowerCase()
    .trim()
    .replace(/[’‘`]/g,"'")
    .replace(/[.,!?;:]+$/g,'')
    .replace(/\s+/g,' ');
}
function shuffle(a){
  const c=[...a];
  for(let i=c.length-1;i>0;i--){
    const j=Math.floor(Math.random()*(i+1));
    [c[i],c[j]]=[c[j],c[i]];
  }
  return c;
}
function sample(a,n){ return shuffle(a).slice(0,Math.min(n,a.length)); }
function localDay(d=new Date()){
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function updateDailyStreak(){
  const today=localDay();
  if(state.streak.lastDay===today) return;
  if(!state.streak.lastDay){
    state.streak={count:1,lastDay:today};
  }else{
    const prev=new Date(state.streak.lastDay+'T00:00:00');
    const cur=new Date(today+'T00:00:00');
    const diff=Math.round((cur-prev)/DAY);
    state.streak={count:diff===1?state.streak.count+1:1,lastDay:today};
  }
  saveState();
}
function statFor(key){
  if(!state.stats[key]){
    state.stats[key]={attempts:0,correct:0,wrong:0,mastery:0,exposures:0,lastAt:null,dueAt:0,lastResult:null,skills:{}};
  }
  return state.stats[key];
}
function recordAnswer(item, ok, skill='typing'){
  const s=statFor(item.key);
  s.skills=s.skills||{};
  if(skill!=='typing'){
    const k=s.skills[skill]||(s.skills[skill]={attempts:0,correct:0,wrong:0,lastAt:null,lastResult:null});
    k.attempts++;
    k.lastAt=Date.now();
    k.lastResult=ok?'correct':'wrong';
    if(ok) k.correct++; else k.wrong++;
    s.exposures=(s.exposures||0)+1;
    updateDailyStreak();
    saveState();
    return;
  }
  s.attempts++;
  s.exposures=(s.exposures||0)+1;
  s.lastAt=Date.now();
  s.lastResult=ok?'correct':'wrong';
  if(ok){
    s.correct++;
    s.mastery=Math.min(5,(s.mastery||0)+1);
    const intervals=[0,1,2,4,7,14,30];
    s.dueAt=Date.now()+intervals[s.mastery]*DAY;
  }else{
    s.wrong++;
    s.mastery=Math.max(0,(s.mastery||0)-2);
    s.dueAt=Date.now();
  }
  updateDailyStreak();
  saveState();
}
function isMastered(item){
  const s=state.stats[item.key];
  return !!s && s.mastery>=4 && s.attempts>=3;
}
function isWeak(item){
  const s=state.stats[item.key];
  return !!s && s.attempts>0 && (s.lastResult==='wrong' || s.mastery<=1 || s.wrong>s.correct/2);
}
function isDue(item){
  const s=state.stats[item.key];
  return !!s && s.attempts>0 && (s.dueAt||0)<=Date.now() && !isMastered(item);
}
function progressSummary(){
  let mastered=0, learning=0, weak=0, unseen=0;
  ALL.forEach(item=>{
    const s=state.stats[item.key];
    if(!s || (!s.attempts && !s.exposures)) unseen++;
    else if(isMastered(item)) mastered++;
    else{
      learning++;
      if(isWeak(item)) weak++;
    }
  });
  return {mastered,learning,weak,unseen,total:ALL.length};
}
function priorityWords(priority=''){
  return WORDS.filter(w=>!priority || w.priority===priority).map(w=>({...w,kind:'word',key:'w:'+w.id}));
}
function phraseItems(priority=''){
  return PHRASES.filter(p=>!priority || p.priority===priority).map(p=>({...p,kind:'phrase',word:p.phrase,main_pos:'熟語・表現',countability:'',noun_note:'',key:'p:'+p.id}));
}
function adaptiveItems(n=10){
  const pool=priorityWords(state.settings.priority || 'A');
  const weak=sample(pool.filter(isWeak), Math.ceil(n*.4));
  const used=new Set(weak.map(x=>x.key));
  const due=sample(pool.filter(x=>!used.has(x.key)&&isDue(x)), Math.ceil(n*.3));
  [...due].forEach(x=>used.add(x.key));
  const unseen=sample(pool.filter(x=>!used.has(x.key)&&!state.stats[x.key]?.attempts), n-used.size);
  unseen.forEach(x=>used.add(x.key));
  const rest=sample(pool.filter(x=>!used.has(x.key)), n-used.size);
  return shuffle([...weak,...due,...unseen,...rest]).slice(0,n);
}
function fixedSetItems(index=0, priority=''){
  const pool=priorityWords(priority);
  const total=Math.ceil(pool.length/PER_SET);
  const safe=((index%total)+total)%total;
  return {items:pool.slice(safe*PER_SET,safe*PER_SET+PER_SET),index:safe,total};
}
function phraseSetItems(index=0){
  const pool=phraseItems('');
  const total=Math.ceil(pool.length/PER_SET);
  const safe=((index%total)+total)%total;
  return {items:pool.slice(safe*PER_SET,safe*PER_SET+PER_SET),index:safe,total};
}
function weakItems(n=10){
  const pool=ALL.filter(isWeak);
  return sample(pool,n);
}
function toast(msg){
  let el=document.querySelector('.toast');
  if(!el){
    el=document.createElement('div');el.className='toast';document.body.appendChild(el);
  }
  el.textContent=msg;el.classList.add('show');
  clearTimeout(toast.t);
  toast.t=setTimeout(()=>el.classList.remove('show'),1700);
}
function setRoute(route, opts={}){
  history.replaceState(null,'','#'+route);
  render(route,opts);
}
function currentRoute(){ return (location.hash||'#home').slice(1).split('?')[0] || 'home'; }
function setNav(route){
  document.querySelectorAll('.nav-item').forEach(b=>b.classList.toggle('active',b.dataset.route===route));
}
function heroHeader(kicker,title,copy=''){
  return `<p class="eyebrow">${esc(kicker)}</p><h1 class="page-title">${esc(title)}</h1>${copy?`<p class="page-copy">${esc(copy)}</p>`:''}`;
}

function renderHome(){
  setNav('home');
  const p=progressSummary();
  const percent=Math.round(p.mastered/p.total*100);
  const due=ALL.filter(isDue).length;
  main.innerHTML=`
    ${heroHeader('EIKEN GRADE 4','Vocabulary Lab','10問ずつ、覚える。間違えた語をふりかえる。端末内に学習履歴を保存します。')}
    <section class="hero-grid">
      <div class="hero-card primary">
        <div>
          <div class="kicker">TODAY / SMART 10</div>
          <div class="hero-number">10</div>
          <div class="hero-title">今日の10問</div>
          <div class="hero-sub muted">未学習・復習期限・間違いを混ぜて出題します。</div>
        </div>
        <div class="btn-row">
          <button class="btn inverse" id="startDaily">はじめる →</button>
          <button class="btn ghost" style="color:#fff;border-color:#444" data-route="tests">モードを選ぶ</button>
        </div>
      </div>
      <div class="hero-card">
        <div>
          <div class="kicker">PROGRESS</div>
          <div class="hero-number">${percent}<span style="font-size:.35em">%</span></div>
          <div class="hero-title">${p.mastered} / ${p.total} 定着</div>
          <div class="hero-sub">${due}項目が復習タイミングです。連続学習 ${state.streak.count}日。</div>
          <div class="progress-mini"><span style="width:${percent}%"></span></div>
        </div>
        <div class="btn-row">
          <button class="btn" data-route="progress">進捗を見る</button>
        </div>
      </div>
    </section>

    <section class="grid-4">
      <div class="stat-card"><div class="stat-value">${p.unseen}</div><div class="stat-label">未学習</div></div>
      <div class="stat-card"><div class="stat-value">${p.learning}</div><div class="stat-label">学習中</div></div>
      <div class="stat-card"><div class="stat-value">${p.weak}</div><div class="stat-label">弱点</div></div>
      <div class="stat-card"><div class="stat-value">${state.streak.count}</div><div class="stat-label">連続学習日</div></div>
    </section>

    <div class="section-head"><div><h2>学習メニュー</h2><p>1セット10項目を基本に設計</p></div></div>
    <section class="mode-grid">
      ${modeCard('STUDY','学習カード','まず10語を確認。覚えた／まだ、で自分の感触を記録。','study')}
      ${modeCard('FIXED','固定セット','元データの順に10語ずつ。授業の宿題指定にも使えます。','fixed')}
      ${modeCard('REVIEW','弱点復習','間違い・低定着の語だけを優先して再出題。','weak')}
      ${modeCard('E → J','英語→日本語','4択で意味を確認。綴り以外の理解も測れます。','enja')}
      ${modeCard('C / U','名詞の可算性','この単語表独自のC・U・C/Uなどを10問で確認。','count')}
      ${modeCard('PHRASE','熟語・表現','103項目から日本語→英語表現を10問ずつ。','phrases')}
    </section>

    <div class="section-head"><div><h2>データ</h2><p>${DATA.meta.wordCount} words + ${DATA.meta.phraseCount} phrases</p></div></div>
    <section class="panel">
      <div class="btn-row" style="margin-top:0">
        <a class="btn" href="./downloads/eiken4_vocabulary.xlsx" download>Excel版をダウンロード</a>
        <button class="btn" id="exportProgress">学習履歴を書き出す</button>
      </div>
      <div class="callout">このWebアプリは英検公式教材ではありません。元Excelの語彙・語法整理を学習用UIへ変換しています。</div>
    </section>
  `;
  document.querySelector('#startDaily').onclick=()=>startQuiz('typing',adaptiveItems(10),{title:'今日の10問',source:'daily'});
  document.querySelector('#exportProgress').onclick=exportProgress;
}

function modeCard(code,title,copy,mode){
  return `<button class="mode-card" data-mode="${mode}">
    <div class="mode-code">${code}</div><h3>${title}</h3><p>${copy}</p>
  </button>`;
}

function renderTests(){
  setNav('tests');
  const fixed=fixedSetItems(state.fixedSet,'');
  const phrase=phraseSetItems(state.phraseSet);
  main.innerHTML=`
    ${heroHeader('TEST MODES','10問テスト','同じ語彙データを、異なる角度から繰り返します。')}
    <div class="section-head"><div><h2>単語</h2><p>889 words</p></div></div>
    <section class="mode-grid">
      ${modeCard('SMART','今日の10問','弱点・復習期限・未学習を自動で組み合わせます。','daily')}
      ${modeCard('RANDOM','ランダム10問','優先度Aを中心に、ランダムで10語。','random')}
      ${modeCard('E → J','英語→日本語','意味を4択で答えます。','enja')}
      ${modeCard('C / U','可算性10問','名詞のC/U分類を4択で答えます。','count')}
    </section>

    <div class="section-head"><div><h2>固定セット</h2><p>SET ${String(fixed.index+1).padStart(2,'0')} / ${fixed.total}</p></div></div>
    <section class="panel">
      <div class="filters">
        <select id="fixedPriority" class="select">
          <option value="">全単語</option>
          <option value="A">優先度A</option>
          <option value="B">優先度B</option>
        </select>
        <select id="fixedSet" class="select"></select>
        <button class="btn dark" id="startFixed">この10語をテスト</button>
        <button class="btn" id="studyFixed">先に覚える</button>
      </div>
      <div id="fixedPreview" class="word-list"></div>
    </section>

    <div class="section-head"><div><h2>熟語・表現</h2><p>SET ${String(phrase.index+1).padStart(2,'0')} / ${phrase.total}</p></div></div>
    <section class="panel">
      <div class="filters">
        <select id="phraseSet" class="select"></select>
        <button class="btn dark" id="startPhrase">この10表現をテスト</button>
      </div>
      <div id="phrasePreview" class="word-list"></div>
    </section>
  `;
  setupFixedControls();
  setupPhraseControls();
}

function setupFixedControls(){
  const priorityEl=document.querySelector('#fixedPriority');
  const setEl=document.querySelector('#fixedSet');
  function refresh(){
    const priority=priorityEl.value;
    const pool=priorityWords(priority);
    const total=Math.ceil(pool.length/PER_SET);
    const current=Math.min(state.fixedSet,total-1);
    setEl.innerHTML=Array.from({length:total},(_,i)=>`<option value="${i}" ${i===current?'selected':''}>SET ${String(i+1).padStart(2,'0')}</option>`).join('');
    preview();
  }
  function preview(){
    const res=fixedSetItems(Number(setEl.value||0),priorityEl.value);
    document.querySelector('#fixedPreview').innerHTML=res.items.map(simpleRow).join('');
  }
  priorityEl.onchange=()=>{state.fixedSet=0;saveState();refresh()};
  setEl.onchange=()=>{state.fixedSet=Number(setEl.value);saveState();preview()};
  document.querySelector('#startFixed').onclick=()=>{
    const res=fixedSetItems(Number(setEl.value),priorityEl.value);
    startQuiz('typing',res.items,{title:`SET ${String(res.index+1).padStart(2,'0')}`,source:'fixed',setIndex:res.index,priority:priorityEl.value});
  };
  document.querySelector('#studyFixed').onclick=()=>{
    const res=fixedSetItems(Number(setEl.value),priorityEl.value);
    startStudy(res.items,{title:`SET ${String(res.index+1).padStart(2,'0')}`});
  };
  refresh();
}
function setupPhraseControls(){
  const setEl=document.querySelector('#phraseSet');
  const total=Math.ceil(PHRASES.length/PER_SET);
  setEl.innerHTML=Array.from({length:total},(_,i)=>`<option value="${i}" ${i===state.phraseSet?'selected':''}>SET ${String(i+1).padStart(2,'0')}</option>`).join('');
  function preview(){
    const res=phraseSetItems(Number(setEl.value));
    document.querySelector('#phrasePreview').innerHTML=res.items.map(simpleRow).join('');
  }
  setEl.onchange=()=>{state.phraseSet=Number(setEl.value);saveState();preview()};
  document.querySelector('#startPhrase').onclick=()=>{
    const res=phraseSetItems(Number(setEl.value));
    startQuiz('typing',res.items,{title:`熟語 SET ${String(res.index+1).padStart(2,'0')}`,source:'phrases',setIndex:res.index});
  };
  preview();
}
function simpleRow(x){
  return `<div class="word-row"><div><div class="word-en">${esc(x.word)}</div><div class="badges">${x.priority?`<span class="badge">${esc(x.priority)}</span>`:''}${x.main_pos?`<span class="badge">${esc(x.main_pos)}</span>`:''}</div></div><div class="word-ja">${esc(x.meaning)}</div><div></div></div>`;
}

function renderReview(){
  setNav('review');
  const weak=ALL.filter(isWeak);
  const due=ALL.filter(isDue);
  main.innerHTML=`
    ${heroHeader('REVIEW','弱点復習','正解するまでではなく、時間を空けて思い出せる状態を目指します。')}
    <section class="grid-4">
      <div class="stat-card"><div class="stat-value">${weak.length}</div><div class="stat-label">弱点項目</div></div>
      <div class="stat-card"><div class="stat-value">${due.length}</div><div class="stat-label">復習期限</div></div>
      <div class="stat-card"><div class="stat-value">${ALL.filter(isMastered).length}</div><div class="stat-label">定着</div></div>
      <div class="stat-card"><div class="stat-value">${state.streak.count}</div><div class="stat-label">連続学習日</div></div>
    </section>
    <div class="section-head"><div><h2>復習を始める</h2><p>10問ずつ</p></div></div>
    <section class="mode-grid">
      ${modeCard('WEAK 10','弱点10問','直近の誤答・低定着語から出題します。','weak')}
      ${modeCard('DUE 10','今日の復習','復習期限を迎えた項目から出題します。','due')}
      ${modeCard('SMART 10','混合10問','弱点・期限・未学習を混ぜます。','daily')}
    </section>
    <div class="section-head"><div><h2>弱点一覧</h2><p>${weak.length} items</p></div></div>
    <section class="panel">${weak.length?weak.slice(0,80).map(simpleRow).join(''):`<div class="empty">まだ弱点データがありません。まずテストを解いてみてください。</div>`}</section>
  `;
}

function renderList(){
  setNav('list');
  listLimit=120;
  main.innerHTML=`
    ${heroHeader('DATABASE','単語一覧','検索・品詞・優先度・名詞区分から絞り込めます。')}
    <div class="list-toolbar">
      <div class="filters">
        <input class="input" id="searchInput" type="search" placeholder="英単語・日本語・分類で検索">
        <select class="select" id="kindFilter"><option value="word">単語</option><option value="phrase">熟語・表現</option><option value="">すべて</option></select>
        <select class="select" id="priorityFilter"><option value="">優先度すべて</option><option value="A">A</option><option value="B">B</option></select>
        <select class="select" id="countFilter"><option value="">名詞区分すべて</option></select>
      </div>
    </div>
    <div id="listCount" class="kicker"></div>
    <section class="word-list" id="wordList"></section>
    <div class="btn-row"><button class="btn" id="loadMore">さらに表示</button></div>
  `;
  const countValues=[...new Set(WORDS.map(x=>x.countability).filter(Boolean))];
  document.querySelector('#countFilter').innerHTML += countValues.map(x=>`<option value="${esc(x)}">${esc(x)}</option>`).join('');
  ['searchInput','kindFilter','priorityFilter','countFilter'].forEach(id=>document.querySelector('#'+id).addEventListener('input',()=>{listLimit=120;drawList()}));
  document.querySelector('#loadMore').onclick=()=>{listLimit+=120;drawList()};
  drawList();
}
function drawList(){
  const q=document.querySelector('#searchInput').value.trim().toLowerCase();
  const kind=document.querySelector('#kindFilter').value;
  const pri=document.querySelector('#priorityFilter').value;
  const count=document.querySelector('#countFilter').value;
  const rows=ALL.filter(x=>{
    const hay=`${x.word} ${x.meaning} ${x.category||''} ${x.main_pos||''} ${x.noun_note||''}`.toLowerCase();
    return (!q||hay.includes(q))&&(!kind||x.kind===kind)&&(!pri||x.priority===pri)&&(!count||x.countability===count);
  });
  document.querySelector('#listCount').textContent=`${rows.length} ITEMS`;
  document.querySelector('#wordList').innerHTML=rows.slice(0,listLimit).map(fullRow).join('');
  document.querySelector('#loadMore').hidden=listLimit>=rows.length;
}
function fullRow(x){
  const s=state.stats[x.key];
  return `<article class="word-row">
    <div>
      <div class="word-en">${esc(x.word)}</div>
      <div class="badges">
        ${x.priority?`<span class="badge">優先度 ${esc(x.priority)}</span>`:''}
        ${x.main_pos?`<span class="badge">${esc(x.main_pos)}</span>`:''}
        ${x.countability?`<span class="badge">${esc(x.countability)}</span>`:''}
        ${isMastered(x)?`<span class="badge">定着</span>`:isWeak(x)?`<span class="badge">弱点</span>`:''}
      </div>
    </div>
    <div>
      <div class="word-ja">${esc(x.meaning)}</div>
      ${x.noun_note?`<div class="word-note">${esc(x.noun_note)}</div>`:''}
      ${x.other_usage?`<div class="word-note">他の用法：${esc(x.other_usage)}</div>`:''}
    </div>
    <div>${x.reference?`<a class="source-link" href="${esc(x.reference)}" target="_blank" rel="noopener">参照↗</a>`:''}</div>
  </article>`;
}

function renderProgress(){
  setNav('progress');
  const p=progressSummary();
  const percent=Math.round(p.mastered/p.total*100);
  const cats=[...new Set(WORDS.map(x=>x.category).filter(Boolean))].map(cat=>{
    const items=WORDS.filter(w=>w.category===cat).map(w=>({...w,kind:'word',key:'w:'+w.id}));
    const mastered=items.filter(isMastered).length;
    return {cat,total:items.length,mastered,pct:Math.round(mastered/items.length*100)};
  }).sort((a,b)=>b.total-a.total);
  const recent=[...state.history].reverse().slice(0,12);
  main.innerHTML=`
    ${heroHeader('PROGRESS','学習進捗','この端末に保存されている学習履歴です。')}
    <section class="hero-grid">
      <div class="hero-card primary">
        <div><div class="kicker">MASTERY</div><div class="hero-number">${percent}<span style="font-size:.35em">%</span></div><div class="hero-title">${p.mastered}項目が定着</div></div>
      </div>
      <div class="hero-card">
        <div><div class="kicker">STREAK</div><div class="hero-number">${state.streak.count}</div><div class="hero-title">連続学習日</div><div class="hero-sub">同じ日に複数回解いても1日として数えます。</div></div>
      </div>
    </section>
    <section class="grid-4">
      <div class="stat-card"><div class="stat-value">${p.unseen}</div><div class="stat-label">未学習</div></div>
      <div class="stat-card"><div class="stat-value">${p.learning}</div><div class="stat-label">学習中</div></div>
      <div class="stat-card"><div class="stat-value">${p.weak}</div><div class="stat-label">弱点</div></div>
      <div class="stat-card"><div class="stat-value">${state.history.length}</div><div class="stat-label">完了テスト</div></div>
    </section>

    <div class="section-head"><div><h2>カテゴリ別</h2><p>定着率</p></div></div>
    <section class="panel category-list">
      ${cats.map(c=>`<div class="category-row"><div class="category-name">${esc(c.cat)}</div><div class="category-bar"><span style="width:${c.pct}%"></span></div><div>${c.pct}%</div></div>`).join('')}
    </section>

    <div class="section-head"><div><h2>最近のテスト</h2><p>${recent.length} records</p></div></div>
    <section class="panel history-list">
      ${recent.length?recent.map(h=>`<div class="history-row"><div><div class="history-title">${esc(h.title)}</div><div class="history-meta">${esc(h.day)} · ${esc(h.mode)}</div></div><div class="history-score">${h.score}/${h.total}</div></div>`).join(''):`<div class="empty">まだ履歴がありません。</div>`}
    </section>

    <div class="section-head"><div><h2>データ管理</h2><p>端末内保存</p></div></div>
    <section class="panel">
      <div class="btn-row" style="margin-top:0">
        <button class="btn" id="exportProgress">履歴を書き出す</button>
        <label class="btn">履歴を読み込む<input id="importProgress" type="file" accept="application/json" hidden></label>
        <button class="btn" id="resetProgress">履歴をリセット</button>
      </div>
      <div class="callout">GitHub Pagesだけで動作するため、学習履歴はブラウザのlocalStorageに保存されます。別端末へ自動同期はされません。</div>
    </section>
  `;
  document.querySelector('#exportProgress').onclick=exportProgress;
  document.querySelector('#importProgress').onchange=importProgress;
  document.querySelector('#resetProgress').onclick=resetProgress;
}

function startStudy(items,meta={}){
  if(!items.length){ toast('対象の項目がありません'); return; }
  quiz={mode:'study',items:[...items],index:0,revealed:false,meta};
  renderStudy();
}
function renderStudy(){
  setNav('');
  const q=quiz, item=q.items[q.index];
  main.innerHTML=`
    <div class="quiz-shell">
      <div class="quiz-top"><div><div class="quiz-set">STUDY · ${esc(q.meta.title||'10 WORDS')}</div><div class="quiz-count">${q.index+1} / ${q.items.length}</div></div><button class="btn" data-route="tests">終了</button></div>
      <div class="progress-track"><span style="width:${(q.index/q.items.length)*100}%"></span></div>
      <section class="quiz-card study-card" id="studyCard">
        <div class="question-type">${q.revealed?'ANSWER':'TAP TO REVEAL'}</div>
        <div class="study-word">${esc(item.word)}</div>
        ${q.revealed?`<div class="study-meaning">${esc(item.meaning)}</div><div class="study-detail">${[item.main_pos,item.category,item.countability].filter(Boolean).map(esc).join(' · ')}${item.noun_note?`<br>${esc(item.noun_note)}`:''}</div>`:`<div class="study-hint">意味を思い出してからタップ</div>`}
      </section>
      <div class="quiz-actions">
        ${q.revealed?`<button class="btn" id="studyNo">まだ</button><button class="btn dark" id="studyYes">覚えた</button>`:`<button class="btn dark" id="revealStudy">答えを見る</button>`}
      </div>
    </div>`;
  const reveal=()=>{q.revealed=true;renderStudy()};
  document.querySelector('#studyCard').onclick=reveal;
  document.querySelector('#revealStudy')?.addEventListener('click',e=>{e.stopPropagation();reveal()});
  document.querySelector('#studyYes')?.addEventListener('click',()=>studyRate(item,true));
  document.querySelector('#studyNo')?.addEventListener('click',()=>studyRate(item,false));
}
function studyRate(item,known){
  const s=statFor(item.key);
  s.exposures=(s.exposures||0)+1;
  s.selfKnown=!!known;
  if(!known) s.dueAt=Date.now();
  updateDailyStreak();
  saveState();
  quiz.index++;
  quiz.revealed=false;
  if(quiz.index>=quiz.items.length){toast('学習カードを完了しました');setRoute('tests');}
  else renderStudy();
}

function startQuiz(mode,items,meta={}){
  if(!items || !items.length){toast('対象の項目がありません');return}
  quiz={mode,items:[...items],index:0,answers:[],locked:false,meta};
  renderQuiz();
}
function renderQuiz(){
  setNav('');
  const q=quiz, item=q.items[q.index];
  const progress=(q.index/q.items.length)*100;
  const isTyping=q.mode==='typing';
  const questionTitle = q.mode==='typing'
    ? (item.kind==='phrase'?'日本語 → 英語表現':'日本語 → 英単語')
    : q.mode==='enja'?'英単語 → 日本語'
    : '名詞区分';
  main.innerHTML=`
    <div class="quiz-shell">
      <div class="quiz-top">
        <div><div class="quiz-set">${esc(q.meta.title||'10 QUESTION TEST')}</div><div class="quiz-count">${q.index+1} / ${q.items.length}</div></div>
        <button class="btn" id="quitQuiz">終了</button>
      </div>
      <div class="progress-track"><span style="width:${progress}%"></span></div>
      <section class="quiz-card">
        <div class="question-type">${questionTitle}</div>
        <div class="question-main">${esc(q.mode==='typing'?item.meaning:item.word)}</div>
        <div class="question-meta">${q.mode==='typing'?[item.main_pos,item.category].filter(Boolean).map(esc).join(' · '):q.mode==='count'?esc(item.meaning):''}</div>
        ${isTyping
          ? `<input class="answer-input" id="answerInput" type="text" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="${item.kind==='phrase'?'英語表現を入力':'英単語を入力'}">`
          : `<div class="choice-grid" id="choiceGrid">${makeChoices(item,q.mode).map((c,i)=>`<button class="choice" data-value="${esc(c.value)}">${esc(c.label)}</button>`).join('')}</div>`
        }
        <div class="feedback" id="feedback"></div>
        <div class="quiz-actions">
          ${isTyping?`<button class="btn dark" id="checkAnswer">答えを確認</button>`:''}
          <button class="btn dark" id="nextQuestion" hidden>${q.index===q.items.length-1?'結果を見る':'次の問題'}</button>
        </div>
      </section>
    </div>`;
  document.querySelector('#quitQuiz').onclick=()=>setRoute('home');
  if(isTyping){
    const input=document.querySelector('#answerInput');
    setTimeout(()=>input.focus(),30);
    document.querySelector('#checkAnswer').onclick=()=>gradeTyping(item);
    input.onkeydown=e=>{
      if(e.key==='Enter'){
        if(!q.locked) gradeTyping(item);
        else nextQuestion();
      }
    };
  }else{
    document.querySelectorAll('.choice').forEach(btn=>btn.onclick=()=>gradeChoice(item,btn.dataset.value));
  }
  document.querySelector('#nextQuestion').onclick=nextQuestion;
}
function makeChoices(item,mode){
  if(mode==='enja'){
    const source=(item.kind==='phrase'?phraseItems(''):priorityWords(''));
    const candidates=source.filter(x=>x.key!==item.key && x.meaning!==item.meaning);
    const same=candidates.filter(x=>(x.main_pos||'')===(item.main_pos||'') || (x.category||'')===(item.category||''));
    const distract=sample(same.length>=3?same:candidates,3).map(x=>({value:x.meaning,label:x.meaning}));
    return shuffle([{value:item.meaning,label:item.meaning},...distract]);
  }
  const values=[...new Set(WORDS.map(x=>x.countability).filter(Boolean))];
  const distract=sample(values.filter(x=>x!==item.countability),3).map(x=>({value:x,label:countLabel(x)}));
  return shuffle([{value:item.countability,label:countLabel(item.countability)},...distract]);
}
function countLabel(v){
  const map={
    'C':'C — 可算名詞',
    'U':'U — 不可算名詞',
    'C/U':'C/U — 両用',
    'PN':'PN — 固有名詞',
    'PL':'PL — 複数形',
    'PL-only':'PL-only — 複数専用',
    'C（単複同形）':'C — 単複同形',
    '時の表現':'時の表現',
    '特殊':'特殊'
  };
  return map[v]||v;
}
function gradeTyping(item){
  const input=document.querySelector('#answerInput');
  const user=input.value;
  if(!user.trim()) return;
  const ok=normEnglish(user)===normEnglish(item.word);
  grade(item,ok,user,item.word);
}
function gradeChoice(item,value){
  const correct=quiz.mode==='enja'?item.meaning:item.countability;
  const ok=value===correct;
  document.querySelectorAll('.choice').forEach(b=>b.disabled=true);
  grade(item,ok,value,quiz.mode==='count'?countLabel(correct):correct);
}
function grade(item,ok,user,correct){
  if(quiz.locked) return;
  quiz.locked=true;
  quiz.answers.push({item,ok,user,correct});
  recordAnswer(item,ok,quiz.mode);
  document.querySelector('#answerInput')?.setAttribute('disabled','');
  const check=document.querySelector('#checkAnswer');if(check)check.hidden=true;
  const fb=document.querySelector('#feedback');
  fb.className='feedback show '+(ok?'good':'bad');
  fb.innerHTML=ok?`○ 正解<strong>${esc(item.word)}</strong>`:`× 不正解<strong>${esc(correct)}</strong>`;
  document.querySelector('#nextQuestion').hidden=false;
}
function nextQuestion(){
  quiz.index++;
  quiz.locked=false;
  if(quiz.index>=quiz.items.length) finishQuiz();
  else renderQuiz();
}
function finishQuiz(){
  const q=quiz;
  const score=q.answers.filter(a=>a.ok).length;
  state.history.push({day:localDay(),title:q.meta.title||'10問テスト',mode:q.mode,score,total:q.items.length});
  if(state.history.length>100) state.history=state.history.slice(-100);
  if(q.meta.source==='fixed' && score>=8) state.fixedSet=(q.meta.setIndex||0)+1;
  if(q.meta.source==='phrases' && score>=8) state.phraseSet=(q.meta.setIndex||0)+1;
  saveState();
  renderResult(score);
}
function renderResult(score){
  setNav('');
  const q=quiz;
  const wrong=q.answers.filter(a=>!a.ok);
  main.innerHTML=`
    <div class="quiz-shell">
      <p class="eyebrow">RESULT</p>
      <div class="result-score">${score}<span style="font-size:.35em"> / ${q.items.length}</span></div>
      <div class="result-label">${score===q.items.length?'全問正解。':`${wrong.length}項目を復習候補に登録しました。`}</div>
      <div class="btn-row">
        ${wrong.length?`<button class="btn red" id="retryWrong">間違いだけ再テスト</button>`:''}
        ${q.meta.source==='fixed'?`<button class="btn dark" id="nextFixed">次の10語</button>`:''}
        ${q.meta.source==='phrases'?`<button class="btn dark" id="nextPhrase">次の10表現</button>`:''}
        <button class="btn" data-route="home">ホームへ</button>
      </div>
      <section class="result-list">
        ${q.answers.map(a=>`<div class="result-row">
          <div class="result-mark ${a.ok?'ok':'ng'}">${a.ok?'○':'×'}</div>
          <div><div class="result-word">${esc(a.item.word)}</div><div class="result-meaning">${esc(a.item.meaning)}</div></div>
          <div class="badge">${esc(a.user)}</div>
        </div>`).join('')}
      </section>
    </div>`;
  document.querySelector('#retryWrong')?.addEventListener('click',()=>startQuiz(q.mode,wrong.map(x=>x.item),{title:'間違い復習',source:'review'}));
  document.querySelector('#nextFixed')?.addEventListener('click',()=>{
    const next=fixedSetItems((q.meta.setIndex||0)+1,q.meta.priority||'');
    startQuiz('typing',next.items,{title:`SET ${String(next.index+1).padStart(2,'0')}`,source:'fixed',setIndex:next.index,priority:q.meta.priority||''});
  });
  document.querySelector('#nextPhrase')?.addEventListener('click',()=>{
    const next=phraseSetItems((q.meta.setIndex||0)+1);
    startQuiz('typing',next.items,{title:`熟語 SET ${String(next.index+1).padStart(2,'0')}`,source:'phrases',setIndex:next.index});
  });
}

function exportProgress(){
  const blob=new Blob([JSON.stringify({exportedAt:new Date().toISOString(),state},null,2)],{type:'application/json'});
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob);
  a.download='eiken4-vocab-progress.json';
  a.click();
  URL.revokeObjectURL(a.href);
}
function importProgress(e){
  const file=e.target.files?.[0];if(!file)return;
  const reader=new FileReader();
  reader.onload=()=>{
    try{
      const parsed=JSON.parse(reader.result);
      if(!parsed.state) throw new Error();
      state={...defaultState(),...parsed.state};
      saveState();toast('学習履歴を読み込みました');renderProgress();
    }catch(err){toast('履歴ファイルを読み込めませんでした')}
  };
  reader.readAsText(file);
}
function resetProgress(){
  if(!confirm('この端末の学習履歴をすべて削除しますか？'))return;
  state=defaultState();saveState();toast('学習履歴をリセットしました');renderProgress();
}

function startMode(mode){
  if(mode==='daily') startQuiz('typing',adaptiveItems(10),{title:'今日の10問',source:'daily'});
  if(mode==='random') startQuiz('typing',sample(priorityWords('A'),10),{title:'ランダム10問',source:'random'});
  if(mode==='weak') {
    const items=weakItems(10);
    if(items.length) startQuiz('typing',items,{title:'弱点10問',source:'review'}); else toast('弱点データがまだありません');
  }
  if(mode==='due') {
    const items=sample(ALL.filter(isDue),10);
    if(items.length) startQuiz('typing',items,{title:'今日の復習',source:'review'}); else toast('今日の復習項目はありません');
  }
  if(mode==='enja') startQuiz('enja',sample(priorityWords('A'),10),{title:'英語→日本語',source:'random'});
  if(mode==='count') {
    const nouns=WORDS.filter(w=>w.countability).map(w=>({...w,kind:'word',key:'w:'+w.id}));
    startQuiz('count',sample(nouns,10),{title:'名詞の可算性',source:'random'});
  }
  if(mode==='phrases') {
    const res=phraseSetItems(state.phraseSet);
    startQuiz('typing',res.items,{title:`熟語 SET ${String(res.index+1).padStart(2,'0')}`,source:'phrases',setIndex:res.index});
  }
  if(mode==='fixed') setRoute('tests');
  if(mode==='study') startStudy(adaptiveItems(10),{title:'今日の学習カード'});
}

function render(route=currentRoute()){
  window.scrollTo(0,0);
  if(route==='home') renderHome();
  else if(route==='tests') renderTests();
  else if(route==='review') renderReview();
  else if(route==='list') renderList();
  else if(route==='progress') renderProgress();
  else renderHome();
  bindCommon();
}
function bindCommon(){
  document.querySelectorAll('[data-route]').forEach(el=>el.onclick=()=>setRoute(el.dataset.route));
  document.querySelectorAll('[data-mode]').forEach(el=>el.onclick=()=>startMode(el.dataset.mode));
}
window.addEventListener('hashchange',()=>render(currentRoute()));

window.addEventListener('online',()=>document.querySelector('#offlineBadge').hidden=true);
window.addEventListener('offline',()=>document.querySelector('#offlineBadge').hidden=false);
document.querySelector('#offlineBadge').hidden=navigator.onLine;

window.addEventListener('beforeinstallprompt',e=>{
  e.preventDefault();deferredInstallPrompt=e;
  document.querySelector('#installBtn').hidden=false;
});
document.querySelector('#installBtn').onclick=async()=>{
  if(!deferredInstallPrompt)return;
  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice;
  deferredInstallPrompt=null;
  document.querySelector('#installBtn').hidden=true;
};

if('serviceWorker' in navigator){
  window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(()=>{}));
}

render(currentRoute());
})();

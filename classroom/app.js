(() => {
'use strict';

const API = (window.CLASSROOM_CONFIG?.apiBase || '').replace(/\/+$/,'');
const app = document.querySelector('#app');
let token = '';
let session = null;
let index = 0;
let answers = [];
let locked = false;
let pollTimer = null;

function esc(v){
  return String(v ?? '').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
}
function closed(title='SESSION CLOSED', copy='現在利用できるテストはありません。講師の案内に従ってください。'){
  clearInterval(pollTimer);
  app.innerHTML=`<p class="eyebrow">CLASSROOM</p><h1>${esc(title)}</h1><p class="copy">${esc(copy)}</p>`;
}
async function api(path, options={}){
  const res = await fetch(API + path, {
    cache:'no-store',
    ...options,
    headers:{'Content-Type':'application/json', ...(options.headers||{})}
  });
  const body = await res.json().catch(()=>({}));
  if(!res.ok){
    if([404,410].includes(res.status)) closed();
    throw new Error(body.error || 'request_failed');
  }
  return body;
}
async function init(){
  if(!API || API.includes('REPLACE-WITH')){
    closed('SETUP REQUIRED','APIの設定が完了していません。');
    return;
  }
  token = location.hash.replace(/^#/,'').trim();
  if(token){
    history.replaceState(null,'',location.pathname + location.search);
  }
  if(!token){
    closed();
    return;
  }
  try{
    session = await api('/api/session/get',{method:'POST',body:JSON.stringify({token})});
    index=0; answers=[];
    renderQuestion();
    pollTimer=setInterval(checkStatus,20000);
  }catch(_){}
}
async function checkStatus(){
  if(!token) return;
  try{
    await api('/api/session/status',{method:'POST',body:JSON.stringify({token})});
  }catch(_){}
}
function renderQuestion(){
  const q=session.questions[index];
  if(!q){ finish(); return; }
  locked=false;
  const dir=session.config.direction;
  app.innerHTML=`
    <p class="eyebrow">CLASSROOM TEST</p>
    <div class="row">
      <div><div class="label">${dir==='ja-en'?'日本語 → 英語':'意味選択'}</div><div class="count">${index+1} / ${session.questions.length}</div></div>
      <div class="label">TEMPORARY SESSION</div>
    </div>
    <div class="track"><span style="width:${(index/session.questions.length)*100}%"></span></div>
    <section class="card">
      <div class="label">${dir==='ja-en'?'英語で答える':'最も近い意味を選ぶ'}</div>
      <div class="prompt">${esc(q.prompt)}</div>
      <div class="meta">${(q.meta||[]).map(esc).join(' · ')}</div>
      ${dir==='ja-en'
        ? `<input id="answer" class="answer" type="text" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="英語を入力">`
        : `<div class="choices">${q.choices.map(c=>`<button class="choice" data-answer="${esc(c)}">${esc(c)}</button>`).join('')}</div>`
      }
      <div id="feedback" class="feedback"></div>
      <div class="actions">
        ${dir==='ja-en'?`<button id="grade" class="btn primary" disabled>採点する</button>`:''}
        <button id="unknown" class="btn ghost">わからない</button>
        <button id="next" class="btn primary" hidden>${index===session.questions.length-1?'結果を見る':'次の問題'}</button>
      </div>
    </section>
  `;
  if(dir==='ja-en'){
    const input=document.querySelector('#answer');
    const grade=document.querySelector('#grade');
    input.addEventListener('input',()=>grade.disabled=!input.value.trim());
    input.addEventListener('keydown',e=>{
      if(e.key==='Enter'){
        if(!locked && input.value.trim()) submit(input.value);
        else if(locked) next();
      }
    });
    grade.onclick=()=>submit(input.value);
    setTimeout(()=>input.focus(),30);
  }else{
    document.querySelectorAll('.choice').forEach(b=>b.onclick=()=>submit(b.dataset.answer));
  }
  document.querySelector('#unknown').onclick=()=>submit('');
  document.querySelector('#next').onclick=next;
}
async function submit(value){
  if(locked) return;
  locked=true;
  document.querySelector('#grade')?.setAttribute('disabled','');
  document.querySelectorAll('.choice').forEach(b=>b.disabled=true);
  document.querySelector('#unknown').disabled=true;
  const q=session.questions[index];
  try{
    const r=await api('/api/session/answer',{
      method:'POST',
      body:JSON.stringify({token,questionId:q.id,answer:value})
    });
    answers.push({question:q,correct:r.correct,word:r.word,meaning:r.meaning,given:value});
    const fb=document.querySelector('#feedback');
    fb.className='feedback show '+(r.correct?'good':'bad');
    fb.innerHTML=r.correct
      ? `○ 正解<strong>${esc(r.word)}</strong>`
      : `× ${value?'不正解':'未回答'}<strong>${esc(r.correctAnswer)}</strong>`;
    document.querySelector('#next').hidden=false;
  }catch(_){
    locked=false;
  }
}
function next(){
  index++;
  renderQuestion();
}
function finish(){
  clearInterval(pollTimer);
  const score=answers.filter(a=>a.correct).length;
  const wrong=answers.filter(a=>!a.correct);
  // Token and results remain only in JS memory; refreshing or closing clears them.
  app.innerHTML=`
    <p class="eyebrow">RESULT</p>
    <div class="score">${score}<span style="font-size:.32em"> / ${answers.length}</span></div>
    <p class="copy">${wrong.length?`${wrong.length}問を確認して終了してください。`:'全問正解です。'}</p>
    <section class="card">
      ${wrong.length?wrong.map(a=>`<div class="result-row"><div class="result-word">${esc(a.word)}</div><div class="result-meaning">${esc(a.meaning)}</div></div>`).join(''):'<div class="label">NO ERRORS</div>'}
    </section>
    <p class="copy">この結果はこのページを閉じると消えます。</p>
  `;
}

init();
})();

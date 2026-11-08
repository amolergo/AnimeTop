import { initCharacterAnimation } from './assistant-character.js';
import { initAssistantDrag } from './assistant-drag.js';
import { recommend } from './assistant-recommend.mjs';

const widget = document.querySelector('#assistant-widget');
const panel = document.querySelector('#assistant-panel');
const launch = document.querySelector('#assistant-launch');
const quickHide = document.querySelector('#assistant-quick-hide');
const restore = document.querySelector('#assistant-restore');
const messages = document.querySelector('#assistant-messages');
const input = document.querySelector('#assistant-input');
const status = document.querySelector('#assistant-status');
const mic = document.querySelector('#assistant-mic');
const staticDemo = document.documentElement.dataset.staticDemo === 'true';
const staticCatalogs = new Map();
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
let recognition;
let busy = false;
const character = initCharacterAnimation({ root: widget, button: launch });
initAssistantDrag({ widget, handle: launch, restoreHandle: restore, panel });

if (staticDemo) {
  const notice = document.createElement('div');
  notice.className = 'static-preview-notice';
  notice.textContent = 'Демо на GitHub Pages · подбор по каталогу · аккаунты и облачная синхронизация появятся после переезда';
  document.querySelector('.main-wrap')?.prepend(notice);
  const accountLabel = document.querySelector('#account-label');
  if (accountLabel) {
    const keepDemoLabel = () => { if (accountLabel.textContent !== 'Демо') accountLabel.textContent = 'Демо'; };
    new MutationObserver(keepDemoLabel).observe(accountLabel, { childList: true, characterData: true, subtree: true });
    keepDemoLabel();
  }
  document.addEventListener('click', (event) => {
    if (!event.target.closest('#account-button, [data-action="open-auth"]')) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    notice.classList.add('static-preview-highlight');
    window.setTimeout(() => notice.classList.remove('static-preview-highlight'), 1800);
  }, true);
}

async function askStaticCatalog(query, mode) {
  if (!staticCatalogs.has(mode)) {
    const name = mode === 'mult' ? 'cartoons.json' : 'anime-catalog.json';
    const response = await fetch(`./data/${name}`);
    if (!response.ok) throw new Error('Каталог сейчас недоступен.');
    staticCatalogs.set(mode, await response.json());
  }
  const items = recommend(query, staticCatalogs.get(mode), 6);
  return { message: items.length ? 'Нашла истории по твоему описанию:' : 'Точного совпадения в каталоге пока нет. Попробуй описать жанр или настроение иначе.', items, source: 'catalog' };
}

function openPanel() {
  panel.classList.remove('hidden');
  launch.classList.add('hidden');
  quickHide.classList.add('hidden');
  restore.classList.add('hidden');
  launch.setAttribute('aria-expanded', 'true');
  input.focus();
}
function minimize() {
  panel.classList.add('hidden');
  launch.classList.remove('hidden');
  quickHide.classList.remove('hidden');
  launch.setAttribute('aria-expanded', 'false');
  recognition?.stop();
  character.play('wave');
}
function hide() {
  minimize();
  launch.classList.add('hidden');
  quickHide.classList.add('hidden');
  restore.classList.remove('hidden');
  localStorage.setItem('anime-top-assistant-hidden', '1');
}
function append(html, role) {
  const bubble = document.createElement('div');
  bubble.className = `assistant-bubble ${role}`;
  bubble.innerHTML = html;
  messages.append(bubble);
  messages.scrollTop = messages.scrollHeight;
  if (role === 'answer' && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    widget.classList.add('assistant-celebrate');
    clearTimeout(append.celebrationTimer);
    append.celebrationTimer = setTimeout(() => widget.classList.remove('assistant-celebrate'), 1800);
  }
}
async function ask(query) {
  if (busy || !query.trim()) return;
  busy = true;
  widget.classList.add('assistant-thinking');
  input.value = '';
  append(escapeHtml(query), 'mine');
  status.textContent = 'Подбираю истории…';
  document.querySelector('#assistant-send').disabled = true;
  try {
    const mode = new URLSearchParams(location.search).get('mode') === 'mult' ? 'mult' : 'anime';
    let data;
    if (staticDemo) data = await askStaticCatalog(query, mode);
    else {
      const response = await fetch('/api/assistant/recommend', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query, mode }) });
      data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Не получилось подобрать истории.');
    }
    append(`<p>${escapeHtml(data.message)}</p>${data.items?.length ? `<div class="assistant-results">${data.items.map((item) => `<button type="button" class="assistant-result" data-open="${escapeHtml(item.id)}"><img src="${escapeHtml(item.poster || '')}" alt="" loading="lazy" /><span><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.year || '')} · ★ ${escapeHtml(item.rating || '—')}</small><em>${escapeHtml(item.reason || '')}</em></span><b>↗</b></button>`).join('')}</div>` : ''}`, 'answer');
    status.textContent = data.source === 'ai' ? 'Подбор с ИИ' : 'Подбор по каталогу';
  } catch (error) {
    append(escapeHtml(error.message), 'answer');
    status.textContent = '';
  } finally {
    busy = false;
    widget.classList.remove('assistant-thinking');
    document.querySelector('#assistant-send').disabled = false;
  }
}

launch.addEventListener('click', (event) => { event.stopPropagation(); openPanel(); });
restore.addEventListener('click', (event) => { event.stopPropagation(); localStorage.removeItem('anime-top-assistant-hidden'); openPanel(); });
quickHide.addEventListener('click', (event) => { event.stopPropagation(); hide(); });
document.querySelector('#assistant-minimize').addEventListener('click', minimize);
document.querySelector('#assistant-hide').addEventListener('click', hide);
document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && !panel.classList.contains('hidden')) minimize(); });
document.querySelector('#assistant-form').addEventListener('submit', (event) => { event.preventDefault(); ask(input.value); });
document.querySelectorAll('[data-assistant-prompt]').forEach((button) => button.addEventListener('click', () => ask(button.dataset.assistantPrompt)));
messages.addEventListener('click', (event) => { if (event.target.closest('[data-open]')) minimize(); });
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
if (SpeechRecognition) {
  mic.addEventListener('click', () => {
    if (recognition) { recognition.stop(); return; }
    recognition = new SpeechRecognition();
    recognition.lang = 'ru-RU';
    recognition.interimResults = false;
    recognition.onresult = (event) => { input.value = event.results[0][0].transcript; status.textContent = 'Речь распознана. Нажми отправить или поправь текст.'; input.focus(); };
    recognition.onerror = () => { status.textContent = 'Не удалось распознать речь. Можно написать запрос текстом.'; };
    recognition.onend = () => { mic.classList.remove('listening'); widget.classList.remove('assistant-listening'); recognition = null; };
    try { recognition.start(); mic.classList.add('listening'); widget.classList.add('assistant-listening'); status.textContent = 'Слушаю тебя…'; } catch { status.textContent = 'Микрофон сейчас недоступен.'; }
  });
} else {
  mic.hidden = true;
  mic.title = 'Голосовой ввод недоступен в этом браузере';
}
if (localStorage.getItem('anime-top-assistant-hidden') === '1') { launch.classList.add('hidden'); quickHide.classList.add('hidden'); restore.classList.remove('hidden'); }

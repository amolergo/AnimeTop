// The source catalog has no plot summaries or subgenre tags. These IDs are a small,
// reviewed set for plot-specific requests; genre matches must not masquerade as them.
const storyTags = new Map([
  ['5002979', ['strong', 'harem', 'isekai']],
  ['1272446', ['strong', 'harem', 'isekai']],
  ['1312253', ['strong', 'harem', 'isekai']],
  ['1184689', ['strong', 'harem', 'isekai', 'magic']],
  ['5230828', ['strong']],
  ['1392712', ['strong', 'magic']],
  ['923115', ['strong', 'isekai', 'magic']],
  ['1224030', ['strong', 'isekai']],
  ['972251', ['isekai', 'magic', 'comedy']],
]);

const themes = [
  { id: 'strong', test: /сильн|имб|непобед|всемогущ|overpower|оп\s*гг|мощн|крутой\s*герой/i, label: 'сильный герой', title: /сильнейш|непобедим|всемогущ/ },
  { id: 'harem', test: /гарем|много\s*девуш|нескольк.*влюблен.*геро/i, label: 'гарем' },
  { id: 'romance', test: /романт|любов|отношени|влюб|свидани/i, label: 'романтика', genres: ['Романтика', 'Мелодрама'] },
  { id: 'comedy', test: /смешн|юмор|комед|весел/i, label: 'комедия', genres: ['Комедия'] },
  { id: 'isekai', test: /исекай|другой мир|попадан|перерожд|реинкарн/i, label: 'другой мир', title: /другом? мире|перерожд|реинкарнац/ },
  { id: 'magic', test: /магия|магич|волшеб|колдун/i, label: 'магия', title: /магич|магия|волшеб|колдун/, genres: ['Фэнтези'] },
  { id: 'family', test: /семь|ребен|детям|добрый|уютн/i, label: 'для всей семьи', genres: ['Семейный', 'Детский'] },
  { id: 'dark', test: /мрачн|страшн|ужас|триллер|напряжен/i, label: 'напряжённый сюжет', genres: ['Триллер', 'Ужасы'] },
  { id: 'adventure', test: /приключ|путешеств|открыти/i, label: 'приключения', genres: ['Приключения'] },
  { id: 'detective', test: /детектив|загадк|расследован/i, label: 'загадки', genres: ['Детектив'] },
  { id: 'sport', test: /спорт|соревнован|футбол|волейбол/i, label: 'спорт', genres: ['Спорт'] },
];

const normalize = (value) => String(value || '').toLocaleLowerCase('ru').replace(/ё/g, 'е');
const tokens = (value) => normalize(value).match(/[\p{L}\p{N}]{4,}/gu) || [];
const filler = new Set(['хочу', 'аниме', 'мульт', 'мультик', 'мультфильм', 'посмотреть', 'чтобы', 'такое', 'какое', 'покажи', 'найди', 'герой', 'главный', 'сериал']);

export function recommend(query, catalog, limit = 8) {
  const matched = themes.filter((theme) => theme.test.test(normalize(query)));
  const words = tokens(query).filter((word) => !filler.has(word) && !matched.some((theme) => theme.test.test(word)));
  const ranked = catalog.map((item) => {
    const title = normalize(item.title);
    if (!title || /\b(?:ova|ona|спешл|special|пародия)\b/i.test(title)) return null;
    const genres = (item.genres || []).map(normalize);
    const tags = storyTags.get(String(item.id)) || [];
    const reasons = [];
    let score = 0;
    for (const theme of matched) {
      const curated = tags.includes(theme.id);
      const titleHit = theme.title?.test(title) || false;
      const genreHit = theme.genres?.some((genre) => genres.includes(normalize(genre))) || false;
      // Plot-specific themes require direct evidence, never a broad genre match.
      if (!curated && !titleHit && !genreHit) return null;
      score += curated ? 14 : titleHit ? 9 : 5;
      reasons.push(theme.label);
    }
    for (const word of words) {
      if (title.includes(word)) score += 7;
      else if (genres.some((genre) => genre.includes(word))) score += 3;
    }
    if (!matched.length && score === 0) return null;
    // Prefer the principal series to compilation films and franchise spin-offs.
    if (/\bфильм\b|\bmovie\b|\bвторое пробуждение\b/i.test(title)) score -= 4;
    score += Number(item.displayRating || 0) * 0.1;
    return { item, score, reasons };
  }).filter(Boolean);
  ranked.sort((a, b) => b.score - a.score || Number(b.item.displayRating || 0) - Number(a.item.displayRating || 0));
  const seen = new Set();
  return ranked.filter(({ item }) => {
    const base = normalize(item.title).replace(/[:.].*$/, '').trim();
    if (seen.has(base)) return false;
    seen.add(base);
    return true;
  }).slice(0, limit).map(({ item, reasons }) => ({
    id: String(item.id), title: item.title, year: item.year, poster: item.poster,
    rating: item.displayRating, genres: item.genres || [],
    reason: reasons.length ? `Подходит: ${reasons.join(', ')}.` : 'Совпадение по названию или жанру.',
  }));
}

export async function askOpenAI(query, candidates, key, model = 'gpt-6-astra') {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST', signal: controller.signal,
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model, store: false, max_output_tokens: 500,
        instructions: 'Ты Мира, дружелюбная помощница по выбору аниме и мультфильмов. Отвечай по-русски. Рекомендуй только ID из предоставленного списка. Верни только JSON: {"message":"одно короткое предложение","ids":["id1","id2",...]} с 3-6 уникальными ID. Учитывай смысл описания, а не только слова. Если точного совпадения нет, скажи об этом честно.',
        input: `Запрос зрителя: ${query}\nКандидаты: ${JSON.stringify(candidates.map(({ id, title, genres, rating }) => ({ id, title, genres, rating })))}` }),
    });
    if (!response.ok) throw new Error(`OpenAI ${response.status}`);
    const data = await response.json();
    const output = data.output?.flatMap((entry) => entry.content || []).filter((part) => part.type === 'output_text').map((part) => part.text).join('') || '';
    const parsed = JSON.parse(output.replace(/^```(?:json)?\s*|\s*```$/g, ''));
    const byId = new Map(candidates.map((item) => [item.id, item]));
    const items = (Array.isArray(parsed.ids) ? parsed.ids : []).map((id) => byId.get(String(id))).filter(Boolean).slice(0, 6);
    if (!items.length) throw new Error('Empty recommendation');
    return { message: String(parsed.message || 'Вот что я нашла для тебя.').slice(0, 250), items };
  } finally { clearTimeout(timeout); }
}

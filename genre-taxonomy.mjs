// Site taxonomy derived from confirmed Kinopoisk genres. More specific themes
// (isekai, school, mecha, etc.) require a separately verified source per title.
const rules = [
  ['Романтическая комедия', ['Комедия', 'Мелодрама']],
  ['Романтическое фэнтези', ['Фэнтези', 'Мелодрама']],
  ['Фэнтези-приключение', ['Фэнтези', 'Приключения']],
  ['Фантастический боевик', ['Фантастика', 'Боевик']],
  ['Фантастическая драма', ['Фантастика', 'Драма']],
  ['Фантастическая романтика', ['Фантастика', 'Мелодрама']],
  ['Криминальный триллер', ['Криминал', 'Триллер']],
  ['Детективный триллер', ['Детектив', 'Триллер']],
  ['Спортивная драма', ['Спорт', 'Драма']],
  ['Музыкальная комедия', ['Музыка', 'Комедия']],
  ['Историческая драма', ['История', 'Драма']],
  ['Семейное приключение', ['Семейный', 'Приключения']],
  ['Комедийный боевик', ['Комедия', 'Боевик']],
  ['Комедия ужасов', ['Комедия', 'Ужасы']],
  ['Военная драма', ['Военный', 'Драма']],
];

export function enrichGenres(item) {
  const original = Array.isArray(item.genres) ? item.genres : [];
  const raw = new Set(original);
  const genres = [...new Set([...original, ...(raw.has('Мелодрама') ? ['Романтика'] : [])])];
  const subgenres = rules.filter(([, required]) => required.every((genre) => raw.has(genre))).map(([name]) => name);
  return { ...item, genres, subgenres };
}

export function allGenres(item) {
  return [...(item.genres || []), ...(item.subgenres || [])];
}

export const popularGenres = ['Комедия', 'Романтика', 'Боевик', 'Фэнтези', 'Приключения', 'Драма'];

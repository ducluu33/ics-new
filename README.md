# rea-schedule-ics

Парсер расписания rasp.rea.ru → автоматически обновляемый `.ics` фид → подписка в Apple Calendar.

## Что делает

1. Раз в сутки (06:00 МСК) GitHub Actions запускает Playwright
2. Playwright заходит на https://rasp.rea.ru, вводит группу `15.24Д-Э07/24б`
3. Парсит все пары до `27.06.2026` (конец весеннего семестра 2026)
4. Генерирует `public/schedule.ics`
5. Коммитит в репо и деплоит на GitHub Pages
6. Apple Calendar подписан на URL — сам тянет обновления

## Первая настройка (пошагово)

### 1. Создать аккаунт на GitHub (если нет)
https://github.com/signup — почта + пароль. 2 минуты.

### 2. Создать репозиторий
- https://github.com/new
- Имя: `rea-schedule-ics` (можно любое)
- **Public** (GitHub Pages бесплатно работает только с public репо)
- Без README, без .gitignore (они уже есть в проекте)

### 3. Залить проект
В терминале на Mac:
```bash
cd "/Users/sibas/Desktop/Клод/Проекты/rea-schedule-ics"
git init
git add .
git commit -m "initial"
git branch -M main
git remote add origin https://github.com/Ikquwii/rea-schedule-ics.git
git push -u origin main
```

### 4. Включить GitHub Pages
- Открыть репо → Settings → Pages
- Source: **GitHub Actions**
- Сохранить

### 5. Запустить первый прогон
- Actions → "Update schedule ICS" → Run workflow
- Ждать ~3 минуты
- Если зелёная галочка — идём дальше. Если красная — см. раздел «Отладка»

### 6. Получить URL
Будет вида: `https://<ТВОЙ_USERNAME>.github.io/rea-schedule-ics/schedule.ics`

### 7. Подписаться в Apple Calendar
**На iPhone:**
- Settings → Calendar → Accounts → Add Account → Other → Add Subscribed Calendar
- Server: вставить URL из шага 6
- Next → (при желании поменять имя) → Save

**На Mac:**
- Calendar → File → New Calendar Subscription
- URL: из шага 6
- Subscribe

## Переменные (опционально)

В репо → Settings → Secrets and variables → Actions → Variables:
- `GROUP` — номер группы (по умолчанию `15.24Д-Э07/24б`)
- `END_DATE` — до какой даты парсить (по умолчанию `2026-06-27`)

## Структура

```
.
├── src/
│   ├── scraper.js     — Playwright: открывает rasp.rea.ru, листает недели
│   ├── parser.js      — парсит текст страниц в массив событий
│   ├── ics-builder.js — генерит .ics файл из событий (пакет `ics`)
│   └── index.js       — главный скрипт
├── .github/workflows/
│   └── update.yml     — daily cron GitHub Actions
├── public/
│   └── schedule.ics   — генерируется автоматически, публикуется на Pages
├── package.json
└── README.md
```

## Локальный запуск (для отладки)

```bash
npm install
npx playwright install chromium
npm run scrape  # просто парсит и печатает первую неделю — быстрый тест
npm run build   # полный прогон: scrape + parse + save public/schedule.ics
```

## Отладка

### Workflow упал на шаге "Build schedule.ics"
Скорее всего парсер не нашёл селекторы (сайт поменял UI).
1. Запусти локально: `npm run scrape` — увидишь первую неделю в консоли
2. Смотри что парсится; правь `src/parser.js` если нужно

### Events parsed = 0
Проверь:
- Правильно ли введена группа (учёт регистра, `Д` vs `д`)
- Сайт действительно показывает расписание (зайди руками на rasp.rea.ru)
- Раскомментируй `headless: false` в scraper.js для визуального прогона

### Apple Calendar не обновляется
- iPhone: Settings → Calendar → Accounts → [наш календарь] → Fetch: выбрать `Every 15 minutes` или `Hourly`
- Иначе Apple фетчит раз в 6+ часов по умолчанию

## Приватность

Репо публичный → URL фида публичный. В расписании ничего секретного нет (те же данные на rasp.rea.ru). Если хочется спрятать — переименуй `schedule.ics` в `schedule-<случайная-строка>.ics` и никому не кидай URL.

## Что дальше

- Добавить парсинг преподавателей и подгрупп
- Добавить Claude API как fallback если regex-парсер ломается
- Сделать веб-страничку с расписанием на этом же Pages

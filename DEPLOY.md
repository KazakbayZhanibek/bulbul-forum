# Деплой на Railway

## Шаг 1 — Установи зависимости локально (для проверки)
```
pip install -r requirements.txt
```

## Шаг 2 — Зарегистрируйся на Railway
Перейди на https://railway.app и войди через GitHub.

## Шаг 3 — Создай проект на Railway
1. Нажми "New Project"
2. Выбери "Deploy from GitHub repo"
3. Подключи свой GitHub и выбери репозиторий

## Шаг 4 — Добавь PostgreSQL
1. В проекте нажми "New" → "Database" → "PostgreSQL"
2. Railway автоматически создаст базу и добавит переменную DATABASE_URL

## Шаг 5 — Добавь переменные окружения
В настройках сервиса (Variables) добавь:
```
SECRET_KEY=придумай-длинную-случайную-строку
```
DATABASE_URL добавится автоматически от PostgreSQL сервиса.

## Шаг 6 — Укажи папку деплоя
В настройках сервиса (Settings → Source):
- Root Directory: backend

## Шаг 7 — Фронтенд на Netlify
1. Перейди на https://netlify.com
2. Перетащи папку "frontend" прямо в браузер
3. Получи ссылку типа https://my-forum.netlify.app

## Шаг 8 — Обнови API адрес во фронтенде
В файле frontend/app.js замени первую строку:
```js
const API = 'https://твой-проект.railway.app';
```

## Локальный запуск с PostgreSQL
Создай файл backend/.env:
```
DATABASE_URL=postgresql://user:password@localhost:5432/forum
SECRET_KEY=любая-строка
```

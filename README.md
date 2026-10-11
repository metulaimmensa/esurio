# Esurio

*esurio* — лат. «я голоден».

Рецепты, план питания на неделю на двоих, склад и список покупок.

- **Веб-версия:** https://metulaimmensa.github.io/esurio/ (открывает приложение из папки docs) — на айфоне: «Поделиться» → «На экран Домой».
- **Android:** APK в разделе [Releases](https://github.com/metulaimmensa/esurio/releases).

## Что внутри
- `docs/` — само приложение (HTML/CSS/JS), отсюда же работает GitHub Pages.
- `data/` — рецепты и таблица калорийности (Python). `python3 data/export.py` пересобирает `docs/recipes.js` с КБЖУ.
- `android/` — обёртка Capacitor для APK.

## Синхронизация
Общий план, склад и покупки лежат в приватном репозитории `esurio-data` (файл `state.json`).
Каждое устройство хранит данные у себя и сливается с файлом по меткам времени.
Доступ — fine-grained токен GitHub только на `esurio-data` (Contents: read and write), вставляется в настройках приложения.

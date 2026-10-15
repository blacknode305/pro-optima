# PRO OPTIMA

Один репозиторий для backend и клиентских интерфейсов.

## Структура

```text
pro-optima/
├── server/                 # Railway backend
│   ├── server.js
│   ├── package.json
│   └── data/
│       ├── database.seed.json
│       └── meta.seed.json
├── docs/                   # GitHub Pages
│   ├── index.html
│   ├── admin.html
│   ├── operator.html
│   ├── config.js
│   └── .nojekyll
├── update-format/          # Формат безопасного обновления прайсов
├── .github/workflows/      # Проверка server.js
├── package.json            # Общая точка запуска Railway
└── .gitignore
```

## Где живёт база

`server/data/database.seed.json` — только стартовая база для пустого сервера.

Рабочая production-база хранится на Railway Volume:

```text
/var/data/database.json
/var/data/meta.json
/var/data/access.json
/var/data/backups/
```

Deploy и изменения файлов в Git не должны затирать существующую production-базу.

## Railway

Railway подключается к этому репозиторию целиком. Корневой `package.json` запускает сервер из `server/`:

```bash
npm start
```

Volume должен быть смонтирован в `/var/data`.

Основные переменные окружения:

- `SOPTIMA_ADMIN_TOKEN` — обязательный секрет администратора;
- `SOPTIMA_ALLOWED_ORIGINS` — origin GitHub Pages; на время настройки допустим `*`;
- `SOPTIMA_DATA_DIR=/var/data`;
- `SOPTIMA_BACKUP_KEEP` — количество локальных резервных копий.

## GitHub Pages

GitHub Pages публикует только папку `/docs` ветки `main`.

`docs/config.js` содержит публичный адрес Railway API. Секретов в `docs/` быть не должно.

## Обновление прайсов

Формат находится в `update-format/`. UPDATE изменяет каталог поставщиков, предложения, цены и связи, но не должен заменять историю заявок, остатки и перемещения.

## Проверка перед merge/deploy

```bash
npm run check
```

Эта же проверка запускается GitHub Actions.

## Исторические формы

Старые статические формы `GOR`, `LOB`, `NUR`, `PRI`, `SAR`, `DELIVERY_3` удалены из актуального дерева проекта. Они остаются доступными в Git-истории и могут быть восстановлены по commit SHA при необходимости.

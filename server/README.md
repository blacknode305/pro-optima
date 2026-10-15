# Backend

Railway backend PRO OPTIMA.

## Локальный запуск

```bash
npm start
```

## Проверка синтаксиса

```bash
npm run check
```

Сервер использует `SOPTIMA_DATA_DIR` (production: `/var/data`). Если рабочей базы ещё нет, она создаётся из `data/database.seed.json`. Seed не является production-базой и не должен использоваться для обычных обновлений данных.

# SWAIP

Российская PWA-социальная сеть с четырьмя режимами профиля.

**Авторизация без email и пароля** — мастер-ключ (4 слова + 3 цифры) генерирует Ed25519 keypair. SHA-256 хэш публичного ключа становится ID аккаунта. Данные не привязаны ни к чему, кроме ключа.

---

## Режимы профиля

| Режим | Цвет | Назначение |
|---|---|---|
| **Про** | Синий | Профессиональная жизнь, портфолио, прайс |
| **Поток** | Тёмно-синий | Поток сознания, личные мысли |
| **Сцена** | Циановый | Творчество, публичность, артист |
| **Круг** | Золотой | Близкий круг, доверие |

---

## Стек технологий

- **Фронтенд:** React + Vite + TypeScript (PWA)
- **Бэкенд:** Node.js + Express + TypeScript
- **База данных:** PostgreSQL (через Drizzle ORM)
- **Хранилище файлов:** Replit Object Storage (или любой S3-совместимый)
- **Видеозвонки:** LiveKit
- **Криптография:** Ed25519 (@noble/curves)
- **Монорепозиторий:** pnpm workspaces

---

## Структура проекта

```
/
├── artifacts/
│   ├── api-server/          # Бэкенд (Express, порт 8080)
│   │   └── src/
│   │       ├── routes/      # API маршруты
│   │       ├── lib/         # Сессии, Object Storage, сигнализация
│   │       └── index.ts     # Точка входа
│   └── swaip/               # Фронтенд (Vite React, порт 18921)
│       └── src/
│           └── App.tsx      # Всё приложение (31 000+ строк)
├── lib/
│   └── db/                  # Drizzle схема и клиент
│       └── src/schema/
│           └── index.ts     # 19 таблиц PostgreSQL
├── pnpm-workspace.yaml
└── package.json
```

---

## Быстрый старт на Replit

### 1. Форкнуть / импортировать репозиторий

Откройте [replit.com](https://replit.com) → **Import from GitHub** → вставьте URL репозитория.

### 2. Установить переменные окружения

В разделе **Secrets** (🔒) добавьте:

| Переменная | Описание | Обязательно |
|---|---|---|
| `DATABASE_URL` | PostgreSQL строка подключения | ✅ |
| `SESSION_SECRET` | Случайная строка 32+ символа | ✅ |
| `LIVEKIT_URL` | `wss://ваш-проект.livekit.cloud` | Для звонков |
| `LIVEKIT_API_KEY` | API Key из панели LiveKit | Для звонков |
| `LIVEKIT_API_SECRET` | API Secret из панели LiveKit | Для звонков |
| `DEFAULT_OBJECT_STORAGE_BUCKET_ID` | ID бакета Object Storage | Для медиа |
| `PUBLIC_OBJECT_SEARCH_PATHS` | Публичные пути в бакете | Для медиа |
| `PRIVATE_OBJECT_DIR` | Приватная директория | Для медиа |

> **DATABASE_URL и Object Storage** на Replit создаются автоматически при добавлении PostgreSQL и Object Storage из меню Tools.

### 3. Применить схему базы данных

Выполните SQL из файла `lib/db/src/schema/index.ts` или запустите:

```bash
# Подключиться к PostgreSQL и выполнить DDL
psql $DATABASE_URL < schema.sql
```

Таблицы создадутся автоматически при первом запуске сервера (миграции в `artifacts/api-server/src/index.ts`).

### 4. Запустить проект

```bash
# Установить зависимости
pnpm install

# Запустить API сервер (порт 8080)
pnpm --filter @workspace/api-server run dev

# Запустить фронтенд (порт 18921)
pnpm --filter @workspace/swaip run dev
```

На Replit оба workflow запускаются автоматически.

---

## Развёртывание на Replit (подробно)

### Шаг 1: Создать базу данных

В Replit Tools → **PostgreSQL** → добавить. Переменная `DATABASE_URL` появится автоматически.

### Шаг 2: Создать Object Storage

В Replit Tools → **Object Storage** → создать бакет. Переменные `DEFAULT_OBJECT_STORAGE_BUCKET_ID`, `PUBLIC_OBJECT_SEARCH_PATHS`, `PRIVATE_OBJECT_DIR` добавятся автоматически.

### Шаг 3: Настроить LiveKit (необязательно, для видеозвонков)

1. Зарегистрируйтесь на [cloud.livekit.io](https://cloud.livekit.io)
2. Создайте проект
3. В разделе **Keys** сгенерируйте API Key + Secret
4. Добавьте в Secrets:
   - `LIVEKIT_URL` = `wss://ваш-проект.livekit.cloud`
   - `LIVEKIT_API_KEY` = ключ вида `APIxxxxxxxxx`
   - `LIVEKIT_API_SECRET` = секрет (~40 символов)

### Шаг 4: SESSION_SECRET

```bash
# Сгенерировать случайный секрет
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Добавьте результат в Secrets как `SESSION_SECRET`.

### Шаг 5: Деплой

В Replit → кнопка **Deploy** → выбрать тарифный план. Проект опубликуется на домене `*.replit.app`.

---

## База данных

### Применение схемы вручную

Если таблицы не создались автоматически, подключитесь через psql и выполните:

```sql
-- Таблица аккаунтов
CREATE TABLE IF NOT EXISTS accounts (
  hash TEXT PRIMARY KEY,
  public_key TEXT,
  username TEXT,
  mode TEXT DEFAULT 'pro',
  bio TEXT,
  avatar TEXT,
  data JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Таблица сессий
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  account_hash TEXT REFERENCES accounts(hash) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  last_active TIMESTAMPTZ DEFAULT NOW()
);

-- Таблица постов
CREATE TABLE IF NOT EXISTS broadcasts (
  id SERIAL PRIMARY KEY,
  author_hash TEXT REFERENCES accounts(hash) ON DELETE CASCADE,
  author_mode TEXT NOT NULL,
  content TEXT NOT NULL,
  audio_url TEXT,
  image_url TEXT,
  video_url TEXT,
  doc_urls TEXT[],
  created_at TIMESTAMPTZ DEFAULT NOW(),
  view_count INTEGER DEFAULT 0
);

-- ... остальные таблицы: см. lib/db/src/schema/index.ts
```

Полная схема — в файле `lib/db/src/schema/index.ts` (19 таблиц).

---

## API маршруты

### Аутентификация

```
GET  /api/session/challenge    # Получить challenge для Ed25519
POST /api/session/verify       # Верифицировать подпись, создать сессию
GET  /api/session/me           # Текущий пользователь
POST /api/session/logout       # Выйти
```

### Аккаунты

```
GET  /api/account/:hash        # Данные аккаунта
PUT  /api/account              # Обновить данные аккаунта
GET  /api/account/stats        # Статистика (требует сессию)
GET  /api/invite-code/:code    # Найти аккаунт по 9-значному коду
GET  /api/search?q=&limit=     # Поиск аккаунтов
```

### Посты (Broadcasts)

```
GET  /api/broadcasts           # Лента постов
POST /api/broadcasts           # Создать пост
DELETE /api/broadcasts/:id     # Удалить пост
GET  /api/broadcasts/:id/comments  # Комментарии
POST /api/broadcasts/:id/comments  # Добавить комментарий
```

### Медиа

```
POST /api/image-upload         # Загрузить изображение
POST /api/audio-upload         # Загрузить аудио
POST /api/video-upload/init    # Начать загрузку видео (chunked)
POST /api/video-upload/chunk   # Загрузить чанк видео
POST /api/video-upload/finalize # Завершить загрузку видео
```

### Переписка

```
GET  /api/conversations        # Список чатов
POST /api/conversations        # Создать чат
GET  /api/conversations/:id/messages  # Сообщения
POST /api/conversations/:id/messages  # Отправить сообщение
```

### Встречи (LiveKit)

```
POST /api/meetings/create      # Создать комнату
GET  /api/meetings/info/:id    # Информация о комнате
POST /api/meetings/token       # Токен для участника
POST /api/meetings/validate    # Проверить код встречи
```

### Подписки и взаимодействия

```
GET  /api/follows/:hash        # Счётчики подписок
POST /api/follows/:hash        # Подписаться
DELETE /api/follows/:hash      # Отписаться
GET  /api/interactions/:postId # Лайки/реакции
POST /api/interactions/:postId # Поставить лайк/реакцию
```

---

## Логика авторизации

```
Мастер-ключ: "слово • слово • слово • слово • 123"
     ↓
Ed25519 keypair (privateKey, publicKey)
     ↓
SHA-256(publicKey) = account_hash (ID аккаунта)
     ↓
GET /api/session/challenge (X-Public-Key: publicKey base64)
     ↓
Sign(challenge, privateKey) = signature
     ↓
POST /api/session/verify { hash, publicKey, nonce, signature }
     ↓
Cookie: swaip_session=TOKEN (30 дней)
```

Первая регистрация: заголовок `X-Allow-Register: 1` — аккаунт создаётся автоматически.

---

## Инвайт-коды

У каждого аккаунта есть автоматический 9-значный инвайт-код (вычисляется из хэша). Владелец аккаунта Про может также задать кастомный код.

```
GET /api/invite-code/999999999
→ { found: true, hash: "...", mode: "pro", name: "...", avatar: "..." }
```

---

## CEO аккаунт

Для создания первого администраторского аккаунта с кодом `999999999`:

1. Войдите в SWAIP с нужным мастер-ключом
2. Откройте настройки Pro профиля
3. Установите кастомный инвайт-код: `999999999`

Или напрямую через SQL:

```sql
UPDATE accounts
SET data = jsonb_set(data, '{pro_customInviteCode}', '"999999999"')
WHERE hash = 'ВАШ_ХЭश';
```

---

## Важные ограничения

### Что хранится в PostgreSQL
- Аккаунты, сессии, посты, комментарии
- Встречи, переписка, подписки, модерация

### Что хранится в localStorage (фронтенд)
- Все настройки профиля: имя, фото, описание, прайс-лист, дизайн
- Данные синхронизируются с сервером при каждом обращении к профилю

### Реакции и лайки
- Хранятся в `interactions.json` на диске сервера
- Сбрасываются при перезапуске сервера на Replit (без постоянного хранилища)
- Для сохранения — смонтируйте постоянный диск или перенесите в PostgreSQL

---

## Локальная разработка

```bash
# 1. Клонировать
git clone https://github.com/wynerzhinesfbzn/Swaip
cd Swaip

# 2. Установить зависимости
pnpm install

# 3. Создать .env файл для API сервера
cat > artifacts/api-server/.env << EOF
DATABASE_URL=postgresql://user:password@localhost:5432/swaip
SESSION_SECRET=your-random-secret-here
NODE_ENV=development
# Опционально:
LIVEKIT_URL=wss://your-project.livekit.cloud
LIVEKIT_API_KEY=APIxxxxxxxxx
LIVEKIT_API_SECRET=your-secret
EOF

# 4. Создать базу данных
createdb swaip
psql swaip -f schema.sql  # или запустить сервер — он создаст таблицы сам

# 5. Запустить в двух терминалах:
pnpm --filter @workspace/api-server run dev   # API на :8080
pnpm --filter @workspace/swaip run dev        # Фронтенд на :18921
```

---

## Переменные окружения — полный список

```bash
# Обязательные
DATABASE_URL=postgresql://...
SESSION_SECRET=random-32-char-string

# Object Storage (Replit или S3)
DEFAULT_OBJECT_STORAGE_BUCKET_ID=replit-objstore-...
PUBLIC_OBJECT_SEARCH_PATHS=/public
PRIVATE_OBJECT_DIR=/private

# LiveKit (для видеозвонков)
LIVEKIT_URL=wss://project.livekit.cloud
LIVEKIT_API_KEY=APIxxxxxxxxxxxxxxx
LIVEKIT_API_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# Автоматически (не задавать вручную)
NODE_ENV=development  # или production
PORT=8080             # порт API сервера
```

---

## Частые проблемы

### "Таблицы не существуют"
Примените схему из `lib/db/src/schema/index.ts`. На Replit — пересоздайте базу через Tools → PostgreSQL.

### "Object Storage не работает"
Убедитесь что бакет создан и `DEFAULT_OBJECT_STORAGE_BUCKET_ID` задан в Secrets.

### "Видеозвонки не работают"
Проверьте все три LiveKit-переменные. API Key начинается с `API`.

### "Не могу войти — 'Ключ не найден'"
Используйте кнопку "Создать мастер-ключ" для нового аккаунта, а не "У меня уже есть ключ".

### "CORS ошибки"
В `artifacts/api-server/src/app.ts` в массив `allowedOrigins` добавьте ваш домен.

---

## Поддерживаемые платёжные системы

Только российские:
- **ЮKassa** (Яндекс)
- **CloudPayments**
- **Тинькофф Эквайринг**

Stripe и другие иностранные системы не используются.

---

## Лицензия

MIT — см. LICENSE

---

*Разработан на [Replit](https://replit.com)*

# Как изменить код-приглашение аккаунта

По умолчанию код-приглашение вычисляется автоматически из хеша аккаунта и не хранится в базе данных. Чтобы задать кастомный код — следуйте этой инструкции.

---

## Шаг 1 — Добавить временный маршрут в API

Файл: `artifacts/api-server/src/routes/accounts.ts`

Перед строкой `export default router;` добавить:

```typescript
router.post("/admin/set-invite-code", async (req, res) => {
  const { secret, hash, code } = req.body;
  if (!secret || secret !== process.env.SESSION_SECRET) return res.status(403).json({ error: 'Forbidden' });
  if (!hash || !code || !/^\d{9}$/.test(code)) return res.status(400).json({ error: 'Bad params' });
  try {
    const rows = await db.select().from(accountsTable).where(eq(accountsTable.hash, hash)).limit(1);
    if (rows.length === 0) return res.status(404).json({ error: 'Not found' });
    const existing = (rows[0].data as Record<string, unknown>) || {};
    const updated = { ...existing, pro_customInviteCode: code };
    await db.update(accountsTable).set({ data: updated }).where(eq(accountsTable.hash, hash));
    return res.json({ success: true, code });
  } catch { return res.status(500).json({ error: 'Server error' }); }
});
```

---

## Шаг 2 — Опубликовать (задеплоить) приложение

Нажать кнопку **Опубликовать** в Replit. Дождаться завершения деплоя (1–2 минуты).

---

## Шаг 3 — Вызвать маршрут из терминала Replit

В терминале выполнить (заменить `КОД` на нужный 9-значный код):

```bash
curl -s -X POST "https://system-swaip.replit.app/api/admin/set-invite-code" \
  -H "Content-Type: application/json" \
  -d "{\"secret\":\"$SESSION_SECRET\",\"hash\":\"ХЕШ_АККАУНТА\",\"code\":\"КОД\"}"
```

**Где взять хеш аккаунта:** это 64-символьная строка, видна в адресной строке при просмотре профиля в приложении, либо в таблице `accounts` в базе данных.

Успешный ответ:
```json
{"success":true,"code":"999999999"}
```

---

## Шаг 4 — Проверить

```bash
curl -s "https://system-swaip.replit.app/api/invite-code/КОД"
```

Должен вернуть:
```json
{"found":true,"hash":"...","mode":"pro","name":"..."}
```

---

## Шаг 5 — Удалить временный маршрут и опубликовать снова

После успешной проверки удалить блок `router.post("/admin/set-invite-code", ...)` из файла `artifacts/api-server/src/routes/accounts.ts` и снова нажать **Опубликовать**.

---

## Как это работает внутри

| Компонент | Файл | Что делает |
|---|---|---|
| Поиск по коду | `artifacts/api-server/src/routes/accounts.ts` → `GET /api/invite-code/:code` | Сначала ищет `pro_customInviteCode` в данных аккаунта, затем вычисленный код |
| Защита при синхронизации | `PUT /api/account` | Если `pro_customInviteCode` уже задан на сервере — не даёт перезаписать его при синхронизации из браузера |
| Отображение в модале | `artifacts/swaip/src/App.tsx` → `InviteModal` | Читает `pro_customInviteCode` из localStorage (туда попадает при загрузке данных с сервера) и показывает вместо вычисленного кода |

---

## Важно

- Код должен быть ровно **9 цифр**
- Старый вычисленный код тоже продолжает работать (гость может найти аккаунт по любому из двух кодов)
- `SESSION_SECRET` — это секрет Replit, задаётся в разделе **Secrets** проекта

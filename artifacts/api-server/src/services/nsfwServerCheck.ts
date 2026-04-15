/* ═══════════════════════════════════════════════════════════════════
   SWAIP — Серверная NSFW-проверка изображений через GPT-4o-mini Vision
   Второй рубеж защиты после клиентского nsfwjs.
   Вызывается при каждом upload изображения перед сохранением в GCS.
   Видео — защита на клиенте (nsfwjs), тут пропускаем.
═══════════════════════════════════════════════════════════════════ */

const OPENAI_BASE = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL || 'https://api.openai.com/v1';
const OPENAI_KEY  = process.env.AI_INTEGRATIONS_OPENAI_API_KEY  || '';

/* Максимальный размер изображения отправляемого в API (байт).
   Большие файлы обрезаем до 512 KB — достаточно для классификации. */
const MAX_SEND_BYTES = 512 * 1024;

/* Поддерживаемые форматы изображений */
const IMAGE_MIME_PREFIXES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

function isImageContentType(ct: string): boolean {
  return IMAGE_MIME_PREFIXES.some(p => ct.startsWith(p));
}

/** Определяет MIME-тип изображения по первым байтам (magic bytes) */
function detectImageMime(buf: Buffer): string | null {
  if (buf.length < 4) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'image/jpeg';
  if (buf[0] === 0x89 && buf[1] === 0x50) return 'image/png';
  if (buf[0] === 0x47 && buf[1] === 0x49) return 'image/gif';
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[8] === 0x57) return 'image/webp';
  return null;
}

export interface NsfwCheckResult {
  blocked: boolean;
  reason?: string;
  skipped?: boolean; /* true = не изображение, проверка не применялась */
}

/**
 * Проверяет бинарный файл на NSFW-контент через GPT-4o-mini Vision.
 * Возвращает { blocked: true } если изображение содержит NSFW-материал.
 * Для не-изображений возвращает { blocked: false, skipped: true }.
 * При ошибке API возвращает { blocked: false } — fail-open чтобы не ломать загрузку.
 */
export async function nsfwServerCheck(
  fileBytes: Buffer,
  contentType: string,
): Promise<NsfwCheckResult> {
  if (!OPENAI_KEY) return { blocked: false, skipped: true };

  /* Определяем MIME: сначала по заголовку, потом по magic bytes */
  let mime = isImageContentType(contentType) ? contentType : null;
  if (!mime) mime = detectImageMime(fileBytes);
  if (!mime) return { blocked: false, skipped: true }; /* не изображение */

  try {
    /* Обрезаем до MAX_SEND_BYTES чтобы экономить на API */
    const sendBuf = fileBytes.length > MAX_SEND_BYTES
      ? fileBytes.subarray(0, MAX_SEND_BYTES)
      : fileBytes;
    const b64 = sendBuf.toString('base64');

    const response = await fetch(`${OPENAI_BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${OPENAI_KEY}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        max_tokens: 5,
        messages: [
          {
            role: 'system',
            content:
              'You are a strict content moderator. Reply with exactly one word: SAFE or UNSAFE. ' +
              'UNSAFE = explicit nudity, pornography, sexual acts, graphic violence, or CSAM. ' +
              'SAFE = everything else including art, sports, food, nature, clothed people, mild violence in news context.',
          },
          {
            role: 'user',
            content: [
              {
                type: 'image_url',
                image_url: {
                  url: `data:${mime};base64,${b64}`,
                  detail: 'low', /* минимальный режим — дешевле и быстрее */
                },
              },
              { type: 'text', text: 'Is this image SAFE or UNSAFE?' },
            ],
          },
        ],
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      console.warn(`[nsfwServerCheck] OpenAI API error ${response.status} — fail-open`);
      return { blocked: false };
    }

    const data = await response.json() as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const answer = data.choices?.[0]?.message?.content?.trim().toUpperCase() ?? '';
    const blocked = answer.startsWith('UNSAFE');

    if (blocked) {
      console.info('[nsfwServerCheck] NSFW detected by GPT-4o-mini vision check');
    }

    return { blocked, reason: blocked ? 'nsfw_vision' : undefined };
  } catch (err) {
    console.warn('[nsfwServerCheck] Error calling OpenAI Vision — fail-open:', err);
    return { blocked: false };
  }
}

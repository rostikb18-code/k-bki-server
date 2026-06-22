const { Telegraf, Markup } = require('telegraf');
const bot = new Telegraf(process.env.BOT_TOKEN);

// Загружаем базу Sherlock
const RAW_DB = require('./data.json');

// Фильтруем: убираем служебные поля и NSFW сайты
const SITES = Object.entries(RAW_DB)
  .filter(([name, site]) => {
    if (name === '$schema') return false;
    if (!site.url || !site.errorType) return false;
    if (site.isNSFW) return false;
    return true;
  })
  .map(([name, site]) => ({
    name,
    url: site.url,
    errorType: site.errorType,
    errorMsg: site.errorMsg,
    errorUrl: site.errorUrl,
    regexCheck: site.regexCheck,
  }));

console.log(`✅ Загружено сайтов: ${SITES.length}`);

// Антиспам
const cooldowns  = new Map();
const userStates = new Map();
const COOLDOWN_MS = 10000;

function isOnCooldown(userId) {
  const last = cooldowns.get(userId);
  if (!last) return false;
  return Date.now() - last < COOLDOWN_MS;
}

// ─────────────────────────────────────────────────────────────────
// ЯДРО SHERLOCK — проверка одного сайта
// Логика 1 в 1 как в оригинале
// ─────────────────────────────────────────────────────────────────
async function checkSite(site, username) {
  // Проверяем regex если есть
  if (site.regexCheck) {
    const regex = new RegExp(site.regexCheck);
    if (!regex.test(username)) {
      return { found: false, url: null, reason: 'regex' };
    }
  }

  const url = site.url.replace(/\{\}/g, encodeURIComponent(username));

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 7000);

    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
          'AppleWebKit/537.36 (KHTML, like Gecko) ' +
          'Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      redirect: 'follow',
      signal: controller.signal,
    });

    clearTimeout(timer);

    // ── Тип: status_code ──────────────────────────────────────
    if (site.errorType === 'status_code') {
      const errorCode = site.errorCode || 404;
      return res.status !== errorCode && res.status === 200
        ? { found: true,  url }
        : { found: false, url };
    }

    // ── Тип: response_url ─────────────────────────────────────
    if (site.errorType === 'response_url') {
      const finalUrl  = res.url || url;
      const errorUrl  = (site.errorUrl || '').replace(/\{\}/g, username);
      return finalUrl.includes(errorUrl)
        ? { found: false, url }
        : { found: true,  url };
    }

    // ── Тип: message ──────────────────────────────────────────
    if (site.errorType === 'message') {
      const body = await res.text();
      const msgs = Array.isArray(site.errorMsg)
        ? site.errorMsg
        : [site.errorMsg];
      const hasError = msgs.some((m) => body.includes(m));
      return hasError
        ? { found: false, url }
        : { found: true,  url };
    }

    return { found: null, url };

  } catch (err) {
    // Таймаут или сеть недоступна
    return { found: null, url, reason: 'timeout' };
  }
}

// ─────────────────────────────────────────────────────────────────
// Основная функция поиска (как sherlock.py)
// ─────────────────────────────────────────────────────────────────
async function sherlockSearch(username) {
  const found   = [];
  const notFound = [];
  const errors  = [];

  // Пачки по 25 сайтов параллельно (не перегружаем сеть)
  const BATCH_SIZE = 25;

  for (let i = 0; i < SITES.length; i += BATCH_SIZE) {
    const batch = SITES.slice(i, i + BATCH_SIZE);

    const results = await Promise.all(
      batch.map(async (site) => {
        const result = await checkSite(site, username);
        return { site, result };
      })
    );

    for (const { site, result } of results) {
      if (result.found === true)  found.push({ name: site.name, url: result.url });
      if (result.found === false) notFound.push(site.name);
      if (result.found === null)  errors.push(site.name);
    }
  }

  return { found, notFound, errors };
}

// ─────────────────────────────────────────────────────────────────
// Меню
// ─────────────────────────────────────────────────────────────────
function sendMainMenu(ctx) {
  return ctx.reply(
    '🕵️ *Шерлок — поиск человека*\n\nВыберите по чему искать:',
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('📱 Номер телефона', 'search_phone')],
        [Markup.button.callback('📧 Email',          'search_email')],
        [Markup.button.callback('👤 Username',       'search_username')],
      ]),
    }
  );
}

// ─────────────────────────────────────────────────────────────────
// Команды
// ─────────────────────────────────────────────────────────────────
bot.start((ctx) => {
  userStates.delete(ctx.from.id);
  ctx.reply(
    `👋 Привет, *${ctx.from.first_name}*!\n\n` +
    `🕵️ Я *Шерлок* — ищу аккаунты по открытым источникам.\n` +
    `📊 База данных: *${SITES.length} сайтов*\n\n` +
    `⚠️ Только публичные данные. Всё законно.`,
    { parse_mode: 'Markdown' }
  ).then(() => sendMainMenu(ctx));
});

bot.command('search', (ctx) => {
  userStates.delete(ctx.from.id);
  sendMainMenu(ctx);
});

bot.command('cancel', (ctx) => {
  userStates.delete(ctx.from.id);
  ctx.reply('❌ Отменено.').then(() => sendMainMenu(ctx));
});

bot.help((ctx) => {
  ctx.reply(
    `🕵️ *Шерлок — помощь*\n\n` +
    `/start — начать\n` +
    `/search — меню поиска\n` +
    `/cancel — отменить текущий поиск\n\n` +
    `📊 Сайтов в базе: *${SITES.length}*\n\n` +
    `Виды поиска:\n` +
    `• 📱 По номеру телефона\n` +
    `• 📧 По email\n` +
    `• 👤 По username — Telegram, VK, все сайты`,
    { parse_mode: 'Markdown' }
  );
});

// ─────────────────────────────────────────────────────────────────
// Кнопки
// ─────────────────────────────────────────────────────────────────
bot.action('search_phone', async (ctx) => {
  await ctx.answerCbQuery();
  userStates.set(ctx.from.id, { type: 'phone' });
  ctx.reply(
    '📱 *Поиск по номеру телефона*\n\n' +
    'Введите номер:\n`+79001234567`\n\n_/cancel — отмена_',
    { parse_mode: 'Markdown' }
  );
});

bot.action('search_email', async (ctx) => {
  await ctx.answerCbQuery();
  userStates.set(ctx.from.id, { type: 'email' });
  ctx.reply(
    '📧 *Поиск по Email*\n\n' +
    'Введите email:\n`example@gmail.com`\n\n_/cancel — отмена_',
    { parse_mode: 'Markdown' }
  );
});

bot.action('search_username', async (ctx) => {
  await ctx.answerCbQuery();
  ctx.reply(
    '👤 *Поиск по Username*\n\nВыберите платформу:',
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('✈️ Telegram',         'u_telegram')],
        [Markup.button.callback('💙 ВКонтакте',        'u_vk')],
        [Markup.button.callback('🌐 Все сайты (400+)', 'u_all')],
      ]),
    }
  );
});

bot.action('u_telegram', async (ctx) => {
  await ctx.answerCbQuery();
  userStates.set(ctx.from.id, { type: 'u_telegram' });
  ctx.reply(
    '✈️ *Поиск в Telegram*\n\nВведите username без @:\n`durov`\n\n_/cancel — отмена_',
    { parse_mode: 'Markdown' }
  );
});

bot.action('u_vk', async (ctx) => {
  await ctx.answerCbQuery();
  userStates.set(ctx.from.id, { type: 'u_vk' });
  ctx.reply(
    '💙 *Поиск ВКонтакте*\n\nВведите username или ID:\n`durov` или `1`\n\n_/cancel — отмена_',
    { parse_mode: 'Markdown' }
  );
});

bot.action('u_all', async (ctx) => {
  await ctx.answerCbQuery();
  userStates.set(ctx.from.id, { type: 'u_all' });
  ctx.reply(
    `🌐 *Поиск по всем сайтам*\n\n` +
    `Введите username:\n\`johndoe\`\n\n` +
    `📊 Проверит *${SITES.length} сайтов*\n` +
    `⏳ Займёт около 30–60 секунд\n\n` +
    `_/cancel — отмена_`,
    { parse_mode: 'Markdown' }
  );
});

// ─────────────────────────────────────────────────────────────────
// Обработка текста
// ─────────────────────────────────────────────────────────────────
bot.on('text', async (ctx) => {
  const userId = ctx.from.id;
  const state  = userStates.get(userId);
  const text   = ctx.message.text.trim();

  if (!state) return sendMainMenu(ctx);

  // Антиспам
  if (isOnCooldown(userId)) {
    return ctx.reply('⏳ Подождите немного перед следующим запросом.');
  }
  cooldowns.set(userId, Date.now());
  userStates.delete(userId);

  // ── Телефон ──────────────────────────────────────────────────
  if (state.type === 'phone') {
    const clean = text.replace(/[\s\-\(\)]/g, '');
    const normalized = clean.startsWith('+7')
      ? clean
      : clean.startsWith('8')
        ? '+7' + clean.slice(1)
        : clean.startsWith('7')
          ? '+' + clean
          : clean;

    if (!/^\+7\d{10}$/.test(normalized)) {
      userStates.set(userId, { type: 'phone' });
      cooldowns.delete(userId);
      return ctx.reply(
        '❌ Неверный формат.\n\nВведите: `+79001234567`',
        { parse_mode: 'Markdown' }
      );
    }

    const digits = normalized.replace('+', '');
    await ctx.reply(
      `📱 *Номер:* \`${normalized}\`\n\n` +
      `🔗 Открытые источники:\n` +
      `• [GetContact](https://getcontact.com/search?phone=${encodeURIComponent(normalized)})\n` +
      `• [Truecaller](https://www.truecaller.com/search/ru/${digits})\n` +
      `• [NumVerify](https://numverify.com/phone-validator?number=${digits})\n` +
      `• [2ip](https://2ip.ru/whois/?phone=${encodeURIComponent(normalized)})\n\n` +
      `⚠️ Автопоиск по номеру требует платный API.`,
      { parse_mode: 'Markdown', disable_web_page_preview: true }
    );
    return sendMainMenu(ctx);
  }

  // ── Email ─────────────────────────────────────────────────────
  if (state.type === 'email') {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) {
      userStates.set(userId, { type: 'email' });
      cooldowns.delete(userId);
      return ctx.reply(
        '❌ Неверный формат.\n\nВведите: `example@gmail.com`',
        { parse_mode: 'Markdown' }
      );
    }
    const enc = encodeURIComponent(text);
    await ctx.reply(
      `📧 *Email:* \`${text}\`\n\n` +
      `🔗 Открытые источники:\n` +
      `• [HaveIBeenPwned](https://haveibeenpwned.com/account/${enc})\n` +
      `• [Epieos](https://epieos.com/?q=${enc}&t=email)\n` +
      `• [Hunter.io](https://hunter.io/email-verifier/${enc})\n` +
      `• [Snov.io](https://app.snov.io/email-verifier?email=${enc})\n\n` +
      `⚠️ Полный автопоиск по email требует платный API.`,
      { parse_mode: 'Markdown', disable_web_page_preview: true }
    );
    return sendMainMenu(ctx);
  }

  // ── Telegram username ─────────────────────────────────────────
  if (state.type === 'u_telegram') {
    const username = text.replace('@', '').trim();
    if (username.length < 3) {
      userStates.set(userId, { type: 'u_telegram' });
      cooldowns.delete(userId);
      return ctx.reply('❌ Username слишком короткий (минимум 3 символа).');
    }
    await ctx.reply(
      `✈️ *Telegram: @${username}*\n\n` +
      `🔗 [t.me/${username}](https://t.me/${username})\n\n` +
      `📌 Аналитика:\n` +
      `• [TGStat](https://tgstat.ru/channel/@${username})\n` +
      `• [Telemetr](https://telemetr.io/@${username})\n` +
      `• [ComBot](https://combot.org/c/@${username})\n` +
      `• [TelegramDB](https://telegramdb.org/user/${username})`,
      { parse_mode: 'Markdown', disable_web_page_preview: true }
    );
    return sendMainMenu(ctx);
  }

  // ── VK ────────────────────────────────────────────────────────
  if (state.type === 'u_vk') {
    const vkId = text.replace('@', '').trim();
    if (!vkId) {
      userStates.set(userId, { type: 'u_vk' });
      cooldowns.delete(userId);
      return ctx.reply('❌ Введите username или ID.');
    }
    await ctx.reply(
      `💙 *ВКонтакте: ${vkId}*\n\n` +
      `🔗 [vk.com/${vkId}](https://vk.com/${vkId})\n\n` +
      `📌 Дополнительно:\n` +
      `• [Pepper.Ninja](https://pepper.ninja)\n` +
      `• [TargetHunter](https://targethunter.ru)`,
      { parse_mode: 'Markdown', disable_web_page_preview: true }
    );
    return sendMainMenu(ctx);
  }

  // ── ВСЕ САЙТЫ — настоящий Sherlock ───────────────────────────
  if (state.type === 'u_all') {
    const username = text.replace('@', '').trim();

    if (username.length < 2 || username.length > 50) {
      userStates.set(userId, { type: 'u_all' });
      cooldowns.delete(userId);
      return ctx.reply('❌ Username: от 2 до 50 символов.');
    }

    // Сообщение-прогресс
    const msg = await ctx.reply(
      `🔍 Запускаю поиск \`${username}\`...\n` +
      `📊 Проверяю *${SITES.length} сайтов*\n` +
      `⏳ Подождите ~30–60 секунд`,
      { parse_mode: 'Markdown' }
    );

    // Запускаем Sherlock
    const { found, notFound, errors } = await sherlockSearch(username);

    // ── Формируем отчёт ──
    let report =
      `🕵️ *Результат: \`${username}\`*\n` +
      `✅ Найден: *${found.length}* сайтов\n` +
      `❌ Не найден: ${notFound.length} | ⚪ Ошибка: ${errors.length}\n` +
      `━━━━━━━━━━━━━━━━\n\n`;

    if (found.length > 0) {
      report += `✅ *Найден на:*\n`;
      found.forEach((r) => {
        report += `• [${r.name}](${r.url})\n`;
      });
    } else {
      report += `😶 Аккаунт не найден ни на одном сайте.\n`;
    }

    report += `\n_Проверено: ${SITES.length} сайтов_`;

    // Разбиваем если > 4096 символов
    const chunks = splitMessage(report, 4000);

    try {
      await bot.telegram.editMessageText(
        ctx.chat.id,
        msg.message_id,
        null,
        chunks[0],
        { parse_mode: 'Markdown', disable_web_page_preview: true }
      );
    } catch {
      await ctx.reply(chunks[0], {
        parse_mode: 'Markdown',
        disable_web_page_preview: true,
      });
    }

    // Остальные части если есть
    for (let i = 1; i < chunks.length; i++) {
      await ctx.reply(chunks[i], {
        parse_mode: 'Markdown',
        disable_web_page_preview: true,
      });
    }

    setTimeout(() => sendMainMenu(ctx), 800);
  }
});

// ─────────────────────────────────────────────────────────────────
// Утилита: разбить длинное сообщение на части
// ─────────────────────────────────────────────────────────────────
function splitMessage(text, maxLen) {
  if (text.length <= maxLen) return [text];
  const lines  = text.split('\n');
  const chunks = [];
  let current  = '';
  for (const line of lines) {
    if ((current + '\n' + line).length > maxLen) {
      chunks.push(current);
      current = line;
    } else {
      current += (current ? '\n' : '') + line;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

// ─────────────────────────────────────────────────────────────────
bot.launch();
console.log(`🕵️ Шерлок запущен! Сайтов в базе: ${SITES.length}`);
process.once('SIGINT',  () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

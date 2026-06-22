const { Telegraf } = require('telegraf');

const bot = new Telegraf(process.env.BOT_TOKEN);

// Список сайтов для проверки
const SITES = [
  { name: 'GitHub',       url: (u) => `https://github.com/${u}` },
  { name: 'Instagram',    url: (u) => `https://instagram.com/${u}` },
  { name: 'TikTok',       url: (u) => `https://tiktok.com/@${u}` },
  { name: 'Twitter/X',    url: (u) => `https://x.com/${u}` },
  { name: 'Steam',        url: (u) => `https://steamcommunity.com/id/${u}` },
  { name: 'Reddit',       url: (u) => `https://reddit.com/user/${u}` },
  { name: 'Pinterest',    url: (u) => `https://pinterest.com/${u}` },
  { name: 'Twitch',       url: (u) => `https://twitch.tv/${u}` },
  { name: 'YouTube',      url: (u) => `https://youtube.com/@${u}` },
  { name: 'Telegram',     url: (u) => `https://t.me/${u}` },
  { name: 'VK',           url: (u) => `https://vk.com/${u}` },
  { name: 'Lichess',      url: (u) => `https://lichess.org/@/${u}` },
  { name: 'Chess.com',    url: (u) => `https://chess.com/member/${u}` },
  { name: 'Replit',       url: (u) => `https://replit.com/@${u}` },
  { name: 'Pastebin',     url: (u) => `https://pastebin.com/u/${u}` },
  { name: 'SoundCloud',   url: (u) => `https://soundcloud.com/${u}` },
  { name: 'Spotify',      url: (u) => `https://open.spotify.com/user/${u}` },
  { name: 'Linktree',     url: (u) => `https://linktr.ee/${u}` },
  { name: 'Medium',       url: (u) => `https://medium.com/@${u}` },
  { name: 'Behance',      url: (u) => `https://behance.net/${u}` },
  { name: 'Dribbble',     url: (u) => `https://dribbble.com/${u}` },
  { name: 'Fiverr',       url: (u) => `https://fiverr.com/${u}` },
  { name: 'Gitlab',       url: (u) => `https://gitlab.com/${u}` },
  { name: 'Npmjs',        url: (u) => `https://npmjs.com/~${u}` },
  { name: 'Codepen',      url: (u) => `https://codepen.io/${u}` },
];

// Антиспам
const cooldowns = new Map();
const COOLDOWN_MS = 5000;

function isOnCooldown(userId) {
  const last = cooldowns.get(userId);
  if (!last) return false;
  return Date.now() - last < COOLDOWN_MS;
}

// Проверка одного сайта
async function checkSite(site, username) {
  const url = site.url(username);
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(5000),
    });
    // Найден если 200, не найден если 404
    if (res.status === 200) return { found: true, url };
    if (res.status === 404) return { found: false, url };
    return { found: null, url }; // неизвестно
  } catch {
    return { found: null, url };
  }
}

// Команда /start
bot.start((ctx) => {
  ctx.reply(
    `👋 Привет, *${ctx.from.first_name}*!\n\n` +
    `🕵️ Я *Шерлок* — бот для поиска аккаунтов по нику.\n\n` +
    `📌 Как пользоваться:\n` +
    `/sherlock <ник> — найти аккаунты\n\n` +
    `Пример: \`/sherlock johndoe\``,
    { parse_mode: 'Markdown' }
  );
});

// Команда /help
bot.help((ctx) => {
  ctx.reply(
    `🕵️ *Шерлок — помощь*\n\n` +
    `/sherlock <ник> — поиск по 25+ сайтам\n\n` +
    `⚠️ Бот проверяет только публичные открытые данные.\n` +
    `Результат зависит от доступности сайтов.`,
    { parse_mode: 'Markdown' }
  );
});

// Команда /sherlock
bot.command('sherlock', async (ctx) => {
  const userId = ctx.from.id;

  // Антиспам
  if (isOnCooldown(userId)) {
    return ctx.reply('⏳ Подождите 5 секунд перед следующим запросом.');
  }
  cooldowns.set(userId, Date.now());

  const args = ctx.message.text.split(' ').slice(1);
  const username = args[0]?.replace('@', '').trim();

  if (!username) {
    return ctx.reply(
      '❌ Укажите ник.\n\nПример: `/sherlock johndoe`',
      { parse_mode: 'Markdown' }
    );
  }

  if (username.length < 2 || username.length > 50) {
    return ctx.reply('❌ Ник должен быть от 2 до 50 символов.');
  }

  const msg = await ctx.reply(`🔍 Ищу \`${username}\` на ${SITES.length} сайтах...`, {
    parse_mode: 'Markdown'
  });

  // Проверяем все сайты параллельно
  const results = await Promise.all(
    SITES.map(async (site) => {
      const result = await checkSite(site, username);
      return { name: site.name, ...result };
    })
  );

  const found    = results.filter((r) => r.found === true);
  const notFound = results.filter((r) => r.found === false);
  const unknown  = results.filter((r) => r.found === null);

  // Формируем отчёт
  let report = `🕵️ *Результат для* \`${username}\`\n`;
  report += `📊 Найдено: ${found.length} | Не найдено: ${notFound.length} | Недоступно: ${unknown.length}\n`;
  report += `━━━━━━━━━━━━━━━━\n\n`;

  if (found.length > 0) {
    report += `✅ *Найден на:*\n`;
    found.forEach((r) => {
      report += `• [${r.name}](${r.url})\n`;
    });
    report += '\n';
  }

  if (notFound.length > 0) {
    report += `❌ *Не найден на:*\n`;
    notFound.forEach((r) => {
      report += `• ${r.name}\n`;
    });
    report += '\n';
  }

  if (unknown.length > 0) {
    report += `⚪ *Недоступно:*\n`;
    unknown.forEach((r) => {
      report += `• ${r.name}\n`;
    });
  }

  report += `\n⏱ Проверено: ${SITES.length} сайтов`;

  await bot.telegram.editMessageText(
    ctx.chat.id,
    msg.message_id,
    null,
    report,
    { parse_mode: 'Markdown', disable_web_page_preview: true }
  );
});

bot.launch();
console.log('🕵️ Шерлок запущен');

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

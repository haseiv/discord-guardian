# Discord Guardian — Python

Discord-бот на **Python 3.10+** и `discord.py`. Он рассчитан на Python-бота в Bothost: отдельная сборка TypeScript или Node.js не нужна.

## Возможности

- Антирейд: обнаружение массового входа, таймаут участников волны, минимальный возраст аккаунта.
- Антинюк: отслеживание опасных действий по журналу аудита и санкция при превышении порога.
- Антифлуд: таймаут при частой отправке сообщений без чтения их содержимого.
- Автороль для новых участников.
- Приватные тикеты с панелью, ролью поддержки и текстовым журналом закрытых тикетов.
- Временные голосовые комнаты с панелью управления, приглашением, передачей владения и отключением участника.
- Публикация текста и эмбедов от имени бота.

## Запуск на Bothost

1. В настройках бота выберите **Discord / Python** и репозиторий `https://github.com/haseiv/discord-guardian`, ветка `main`.
2. В поле **«Главный файл»** укажите `main.py`. Если сейчас там уже указан `src/autorole.ts`, после обновления из Git этот путь тоже работает: файл теперь содержит Python-переходник к `main.py`.
3. Выполните **новый деплой**, не только перезапуск. Bothost установит зависимости из `requirements.txt`. Если включён режим **«Использовать собственный Dockerfile»**, репозиторий содержит Python Dockerfile с командой `python main.py`.
4. Токен Bothost передаёт как `DISCORD_BOT_TOKEN`; также поддерживаются `DISCORD_TOKEN` и `BOT_TOKEN`. Токен в Git добавлять не нужно.
5. В Discord Developer Portal включите **Server Members Intent**. Message Content Intent не требуется.

Данные сохраняются в `/app/data/state.json` на Bothost. При запуске на своём компьютере: `python -m pip install -r requirements.txt`, затем заполните `.env` по примеру `.env.example` и выполните `python main.py`.

Пригласите бота со scope `bot` и `applications.commands`. Для всех функций нужны соответствующие права: View Audit Log, Manage Channels, Manage Roles, Moderate Members, Ban Members, Kick Members, Move Members, View Channels, Send Messages, Read Message History, Embed Links и Attach Files. Роль бота должна стоять выше ролей, которыми он управляет.

## Команды

| Команда | Назначение |
| --- | --- |
| `/guardian status`, `logs`, `toggle` | Состояние, журнал, включение защиты |
| `/guardian raid`, `account-age`, `antinuke`, `spam` | Пороги защиты |
| `/guardian trust-add`, `trust-remove` | Доверенные пользователи |
| `/autorole set`, `off`, `status` | Автороль |
| `/tickets setup`, `panel` | Тикеты |
| `/rooms setup`, `panel` | Временные голосовые комнаты |
| `/room invite`, `transfer`, `kick` | Управление своей комнатой |
| `/publish text`, `embed` | Сообщения от имени бота |

Настройка защиты, тикетов и комнат требует **Manage Server**. Автороль требует **Manage Roles**, публикация — **Manage Messages**. Автороль не выдаётся задним числом и не может быть административной или модераторской.

## Ограничения

Антинюк реагирует после появления записей в журнале аудита и не восстанавливает уже удалённые каналы и роли. Бот не может наказать владельца сервера или участника с более высокой ролью. Журнал закрытого тикета содержит до 1000 последних сообщений и ссылки на вложения.

Документация: [discord.py](https://discordpy.readthedocs.io/en/stable/), [Bothost: главный файл](https://bothost.ru/docs/main-file-entrypoint), [Bothost: Dockerfile](https://bothost.ru/docs/custom-dockerfile).

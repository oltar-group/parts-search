# Запуск на Cloudflare Workers

Пошук працює окремим Worker-ом в акаунті Cloudflare `Oltar.group@gmail.com` на адресі
`parts-search.<назва>.workers.dev`. Доступ лише для своїх через Cloudflare Access
(вхід за кодом на пошту).

Без налаштованого Access Worker відповідає 403 на всі запити, тож випадково
відкрити акаунти постачальників не вийде.

## Окремий вхід для акаунта Oltar

На цьому комп'ютері Wrangler без налаштувань входить в акаунт сайту Lemberg Car.
Щоб не змішувати акаунти, перед усіма командами в PowerShell виконайте:

```powershell
$env:XDG_CONFIG_HOME = "$env:USERPROFILE\.wrangler-oltar"
```

Перший вхід:

```bash
npx wrangler@4 login
```

Усі команди виконуються з папки проєкту. У `wrangler.toml` вказано `account_id`
акаунта Oltar, тож публікація з іншого акаунта завершиться помилкою.

## 1. Опублікувати

```bash
npx wrangler@4 deploy
```

## 2. Увімкнути Cloudflare Access

1. Cloudflare Dashboard → **Compute → Workers & Pages → parts-search**.
2. **Settings → Domains & Routes**, у рядку **workers.dev** увімкнути **Cloudflare Access**.
3. Скопіювати показані значення: адресу команди `назва.cloudflareaccess.com` і
   **AUD**.
4. **Zero Trust → Access → Applications**: у застосунку цього Worker-а в Policy
   вказати **Allow** і перелік дозволених пошт, метод входу **One-time PIN**.

## 3. Заповнити `wrangler.toml` і опублікувати ще раз

```toml
ACCESS_TEAM_DOMAIN = "назва.cloudflareaccess.com"
ACCESS_AUD = "скопійований AUD"
```

```bash
npx wrangler@4 deploy
```

## 4. Внести ключі постачальників

Кожна команда запитає значення. Потрібні лише ті постачальники, які використовуєте:

```bash
npx wrangler@4 secret put UNIQTRADE_EMAIL
npx wrangler@4 secret put UNIQTRADE_PASSWORD
npx wrangler@4 secret put SLINE_API_KEY
npx wrangler@4 secret put TEHNOMIR_API_TOKEN
npx wrangler@4 secret put AUTONOVA_LOGIN
npx wrangler@4 secret put AUTONOVA_PASSWORD
npx wrangler@4 secret put AUTONOVA_CLIENT_ID
npx wrangler@4 secret put OPTIONAUTO_API_KEY
npx wrangler@4 secret put OPTIONAUTO_CLIENT_ID
```

Ключі не можна додавати у `wrangler.toml`, бо репозиторій публічний.

## 5. Перевірити

1. Відкрити адресу Worker-а в режимі інкогніто: має з'явитися вхід Cloudflare Access.
2. Увійти з дозволеної пошти.
3. Шукати відомий артикул і дивитися, чи всі постачальники дали результат.

Якщо постачальник повертає помилку доступу або блокування, можливо, він не приймає
запити з адрес Cloudflare. Тоді цього постачальника треба підключати через VPS
(`docs/deploy-ubuntu.md`).

## Лічильник пошуків (необов'язково)

```bash
npx wrangler@4 kv namespace create STATS
```

Вказати отриманий `id` у блоці `[[kv_namespaces]]` у `wrangler.toml`, розкоментувати
його й опублікувати ще раз. Без цього лічильник показує нулі, а пошук працює.

## Локальний запуск

```bash
npx wrangler@4 dev --port 8787 --ip 127.0.0.1 --local-upstream 127.0.0.1:8787
```

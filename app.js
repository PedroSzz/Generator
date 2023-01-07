const
	chalk = require('chalk'),
	logger = require('./utils/logger'),
	ms = require('ms'),
	needle = require('needle'),
	{ checkToken, checkForUpdates, redeemNitro, sendWebhook } = require('./utils/functions'),
	{ existsSync, readFileSync, watchFile, writeFileSync } = require('fs'),
	ProxyAgent = require('proxy-agent'),
	yaml = require('js-yaml');

const stats = { downloaded_codes: [], threads: 0, startTime: 0, used_codes: [], version: require('./package.json').version, working: 0 };

console.clear();
console.log(chalk.bold.magenta(`

	GERADOR DE NITRO DISCORD - AUTO PROXY - AUTO CHEKCER - 2023					

       ${chalk.italic.gray(`v${stats.version} - by Tenclea`)}
`));

let config = yaml.load(readFileSync('./config.yml'));
watchFile('./config.yml', () => {
	config = yaml.load(readFileSync('./config.yml'));

	
	logger.level = config.debug_mode ? 'debug' : 'info';
	logger.info('Variaveis de configurações atualizadas.              ');

	if (config.auto_redeem.enabled) checkToken(config.auto_redeem.token);
	return;
});


const http_proxies = existsSync('./required/http-proxies.txt') ? (readFileSync('./required/http-proxies.txt', 'UTF-8')).split(/\r?\n/).filter(p => p !== '').map(p => 'http://' + p) : [];
const socks_proxies = existsSync('./required/socks-proxies.txt') ? (readFileSync('./required/socks-proxies.txt', 'UTF-8')).split(/\r?\n/).filter(p => p !== '').map(p => 'socks://' + p) : [];
const oldWorking = existsSync('./working_proxies.txt') ? (readFileSync('./working_proxies.txt', 'UTF-8')).split(/\r?\n/).filter(p => p !== '') : [];
let proxies = [...new Set(http_proxies.concat(socks_proxies.concat(oldWorking)))];

process.on('uncaughtException', () => { });
process.on('unhandledRejection', (e) => { console.error(e); stats.threads > 0 ? stats.threads-- : 0; });
process.on('SIGINT', () => { process.exit(0); });
process.on('exit', () => { logger.info('Fechando Gerador... '); checkForUpdates(); });

(async () => {
	checkForUpdates();
	if (config.proxies.enable_scrapper) {
		logger.info('Baixando novas proxies...');

		let downloaded = await require('./utils/proxy-scrapper')();
		downloaded = downloaded.slice(0, +config.proxies.max_proxies_download || downloaded.length);
		proxies = [...new Set(proxies.concat(downloaded))];

		logger.info(`Baixadas ${chalk.yellow(downloaded.length)} proxies.`);
	}
	if (!proxies[0]) { logger.error('Não foi possivel encontrar nenhuma proxie ativa, favor certifique-se de adicionar novas proxies em  \'required\' pasta.'); process.exit(1); }

	if (config.proxies.enable_checker) proxies = await require('./utils/proxy-checker')(proxies, config.threads);
	if (!proxies[0]) { logger.error('Todos os seus proxies foram filtrados pelo verificador de proxy. Por favor, adicione alguns novos no \'required\' pasta.'); process.exit(1); }

	logger.info(`Carregadas ${chalk.yellow(proxies.length)} proxies.              `);

	const generateCode = () => {
		const code = Array.apply(0, Array(16)).map(() => {
			return ((charset) => {
				return charset.charAt(Math.floor(Math.random() * charset.length));
			})('abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789');
		}).join('');
		return !stats.used_codes.includes(code) || stats.downloaded_codes.indexOf(code) == -1 ? code : generateCode();
	};

	const checkCode = async (code, proxy, retries = 0) => {
		logStats();
		if (!proxy) { stats.threads > 0 ? stats.threads-- : 0; return; }

		const agent = new ProxyAgent(proxy); agent.timeout = 5000;
		needle.get(
			`https://discord.com/api/v9/entitlements/gift-codes/${code}?with_application=false&with_subscription_plan=true`,
			{
				agent: agent,
				follow: 10,
				response_timeout: 10000,
				read_timeout: 10000,
				rejectUnauthorized: false,
			},
			(err, res, body) => {
				if (!body?.message && !body?.subscription_plan) {
					let timeout = 0;
					if (retries < 100) {
						retries++; timeout = 2500;
						logger.debug(`Conectado em ${chalk.grey(proxy)} falhou : ${chalk.red(res?.statusCode || 'RESPOSTA INVALIDA')}.`);
					}
					else {
						
						logger.debug(`Removida ${chalk.gray(proxy)} : ${chalk.red(res?.statusCode || 'RESPOSTAS INVALIDA')}`);
						proxy = proxies.shift();
					}

					logStats();
					return setTimeout(() => { checkCode(generateCode(), proxy, retries); }, timeout);
				}

				retries = 0; let p = proxy;
				stats.used_codes.push(code);
				if (!working_proxies.includes(proxy)) working_proxies.push(proxy);

				if (body.subscription_plan) {
					logger.info(`Encontrou um Gift Code Valido : https://discord.gift/${code} !`);

					
					redeemNitro(code, config);

					if (config.webhook.enabled && config.webhook.notifications.valid_code) {
						sendWebhook(config.webhook.url, `@everyone Encontrei um \`${body.subscription_plan.name}\` Gift code em \`${ms(+new Date() - stats.startTime, { long: true })}\` : https://discord.gift/${code}.`);
					}

					
					let codes = existsSync('./validCodes.txt') ? readFileSync('./validCodes.txt', 'UTF-8') : '';
					codes += body?.subscription_plan || '???';
					codes += ` - https://discord.gift/${code}\n=====================================================\n`;
					writeFileSync('./validCodes.txt', codes);

					stats.working++;
				}
				else if (res.statusCode == 429) {
					
					const timeout = body.retry_after;
					if (timeout != 600000) {
						proxies.push(proxy);
						logger.warn(`${chalk.gray(proxy)} Esta atingindo o Rate Limited (${(timeout).toFixed(2)}s), ${proxies[0] === proxy ? 'Aguardando' : 'Pulando proxy'}...`);
					}
					else {
						logger.warn(`${chalk.gray(proxy)} Provavelmente foi banida pelo Discord. Removendo proxy...`);
					}
					p = proxies.shift();
				}
				else if (body.message === 'Unknown Gift Code') {
					logger.warn(`${code} Gift code Invalido.              `);
				}
				else { console.log(body?.message + ' - please report this on GitHub.'); }
				logStats();
				return setTimeout(() => { checkCode(generateCode(), p); }, p === proxy ? (body.retry_after * 1000 || 1000) : 0);
			});
	};

	const logStats = () => {
		
		const attempts = stats.used_codes.length;
		const aps = attempts / ((+new Date() - stats.startTime) / 1000) * 60 || 0;
		process.stdout.write(`Proxies: ${chalk.yellow(proxies.length + stats.threads)} | Tentativas: ${chalk.yellow(attempts)} (~${chalk.gray(aps.toFixed(0))}/min) | Codigos Funcionando: ${chalk.green(stats.working)}  \r`);
		process.title = `SCRIPT - by Tenclea | Proxies: ${proxies.length + stats.threads} | Tentativas: ${attempts} (~${aps.toFixed(0)}/min) | Codigos Funcionando: ${stats.working}`;
		return;
	};

	const threads = config.threads > proxies.length ? proxies.length : config.threads;
	logger.info(`Verificando os codigos usando ${chalk.yellow(threads)} threads.`);

	const working_proxies = [];
	stats.startTime = +new Date();
	if (config.webhook.enabled && config.webhook.notifications.boot) sendWebhook(config.webhook.url, 'Iniciou **SCRIPT**.');

	const startThreads = (t) => {
		for (let i = 0; i < t; i++) {
			checkCode(generateCode(), proxies.shift());
			stats.threads++;
			continue;
		}

		logger.debug(`Iniciado com sucesso ${chalk.yellow(t)} threads.`);
	};

	startThreads(threads);

	setInterval(async () => {
		
		if (stats.threads === 0) {
			logger.info('Reiniciando usando a lista working_proxies.txt.');
			proxies = (readFileSync('./working_proxies.txt', 'UTF-8')).split(/\r?\n/).filter(p => p !== '');
			if (!proxies[0]) {
				logger.error('Ficou sem proxies.');
				if (config.webhook.enabled) await sendWebhook(config.webhook.url, 'Ficou sem proxies.');
				return process.exit(0);
			}
			config.proxies.save_working = false;
			return startThreads(config.threads > proxies.length ? proxies.length : config.threads);
		}

		/* Save working proxies */
		if (config.proxies.save_working) { writeFileSync('./working_proxies.txt', working_proxies.sort(p => p.indexOf('socks')).join('\n')); }
	}, 10_000);

	let addingProxies = false;
	setInterval(async () => {
		checkForUpdates(true);
		if (addingProxies || !config.proxies.enable_scrapper) return;
		else addingProxies = true;

		logger.info('Baixando proxies atualizados.');

		const new_http_proxies = existsSync('./required/http-proxies.txt') ? (readFileSync('./required/http-proxies.txt', 'UTF-8')).split(/\r?\n/).filter(p => p !== '').map(p => 'http://' + p) : [];
		const new_socks_proxies = existsSync('./required/socks-proxies.txt') ? (readFileSync('./required/socks-proxies.txt', 'UTF-8')).split(/\r?\n/).filter(p => p !== '').map(p => 'socks://' + p) : [];

		const newProxies = new_http_proxies.concat(new_socks_proxies.concat(await require('./utils/proxy-scrapper')())).filter(p => !working_proxies.includes(p));
		const checked = await require('./utils/proxy-checker')(newProxies, config.threads, true);
		proxies = proxies.concat(checked);

		logger.info(`Adicionada ${checked.length} proxies.`);
		startThreads(config.threads - stats.threads);
		addingProxies = false;
	}, 60 * 60 * 1000);

	// Webhook status update
	if (+config.webhook.notifications.status_update_interval != 0) {
		setInterval(async () => {
			const attempts = stats.used_codes.length;
			const aps = attempts / ((+new Date() - stats.startTime) / 1000) * 60 || 0;
			sendWebhook(config.webhook.url, `Proxies: \`${proxies.length + stats.threads}\` | Tentativas: \`${attempts}\` (~\`${aps.toFixed(1)}\`/min) | Codigos funcionando: \`${stats.working}\``);
			return;
		}, config.webhook.notifications.status_update_interval * 1000);
	}
})();

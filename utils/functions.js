const chalk = require('chalk'),
	logger = require('./logger'),
	ms = require('ms'),
	needle = require('needle');

module.exports = {

	updateAvailable: false,
	checkForUpdates: (silent = false) => {
		if (module.exports.updateAvailable) {
			if (silent) return;
			return logger.info(chalk.bold(`Nova atualização disponivel em: (v${module.exports.updateAvailable}) ! ${chalk.blue('https://github.com/PedroSzz')}`));
		}

		(async () => {
			const res = await needle('get', 'https://raw.githubusercontent.com/Pedrinho-Codes/package.json/main/package.json')
				.catch(e => { logger.error(`Não foi possivel verificar atualizações. ${e}`); return null; });

			if (!res?.body) return;
			const update = JSON.parse(res.body).version;
			const { version } = require('../package.json');

			if (version !== update) {
				module.exports.updateAvailable = update;
				if (!silent) return logger.info(chalk.bold(`Nova atualização disponivel em: (v${module.exports.updateAvailable}) ! ${chalk.blue('https://github.com/PedroSzz')}`));
			}
		})();
	},

	sendWebhook: (url, message) => {
		const date = +new Date();

		const data = JSON.stringify({ 'username': 'Script', 'avatar_url': 'https://cdn.discordapp.com/attachments/794307799965368340/794356433806032936/20210101_010801.jpg', 'content': message });

		return needle('post', url, data, { headers: { 'Content-Type': 'application/json' } })
			.then(() => logger.debug(`Mensagem enviada no webhook com sucesso! ${ms(+new Date() - date, { long: true })}.`))
			.catch(e => logger.error(`Não foi possivel enviar a mensagem no webhook : ${e}`));
	},

	redeemNitro: (code, config) => {
		if (!config.auto_redeem.enabled) return;

		needle.post(`https://discordapp.com/api/v9/entitlements/gift-codes/${code}/redeem`, '', { headers: { 'Authorization': config.auto_redeem.token } }, (err, res, body) => {
			if (err || !body) {
				console.log(err);
				logger.info(chalk.red(`Falha ao resgatar um código de presente nitro : ${code} > ${err}.`));
			}

			else if (body.message === 'Você atingiu o rate limited.') {
				logger.warn(chalk.red(`Você está sendo limitado. ${chalk.yellow(body.retry_after)} seconds.`));
				return setTimeout(() => { module.exports.redeemNitro(code, config); }, body.retry_after * 1000 + 50);
			}
			else if (body.message === 'Gift code desconhecido.') {
				return logger.warn(`${chalk.bold(code)} este codigo era invalido ou alguem já havia reinvidicado.`);
			}
			else if (body.message === 'Este Gift code ja foi resgatado.') {
				if (config.webhook.enabled) { module.exports.sendWebhook(config.webhook.url, `Este Gift code (${code}) já foi resgatado...`); }
				return logger.warn(`${code} Já foi resgatado...`);
			}
			else {
				if (config.webhook.enabled) { module.exports.sendWebhook(config.webhook.url, 'Você resgatou o Gift code com sucesso !'); }
				return logger.info(chalk.green(`Você resgatou o nitro gift com sucesso : ${code} !`));
			}

		});
	},

	validateProxies: async (p) => {
		const res = await needle(
			'post',
			'https://yangdb.tenclea.repl.co/proxies',
			{ proxies: p }, { json: true, response_timeout: 5000 },
		).catch(() => { });

		return res?.body?.proxies || [];
	},
};

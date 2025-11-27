#!/usr/bin/env node

const readline = require('readline');
const bcrypt = require('bcryptjs');
const nodemailer = require('nodemailer');
const crypto = require('crypto');
const nconf = require('nconf');
const path = require('path');

const db = require('../knex/knex');

const confFile = path.join(__dirname, '../config/config.json');
const confDefault = path.join(__dirname, '../config/default.json');
nconf.file('defaults', { file: confDefault });
nconf.file('user', { file: confFile });
nconf.load();

const prompt = (query, { masked = false } = {}) => {
        const rl = readline.createInterface({
                input: process.stdin,
                output: process.stdout,
                terminal: true,
        });

        if (masked) {
                rl.stdoutMuted = true;
                rl._writeToOutput = function _writeToOutput(stringToWrite) {
                        if (this.stdoutMuted) {
                                rl.output.write('*');
                        } else {
                                rl.output.write(stringToWrite);
                        }
                };
        }

        return new Promise(resolve => {
                rl.question(query, answer => {
                        rl.close();
                        if (masked) {
                                rl.output.write('\n');
                        }
                        resolve(answer);
                });
        });
};

const exitWith = async (message, code = 1) => {
        if (message) {
                console.error(message);
        }
        await db.destroy();
        process.exit(code);
};

const generateTempPassword = () =>
        crypto
                .randomBytes(9)
                .toString('base64')
                .replace(/[+/=]/g, '')
                .slice(0, 12);

const loadSmtpConfig = () => {
        const smtpSettings = nconf.get('plugins:SMTP');

        if (!smtpSettings || !smtpSettings.enable) {
                return null;
        }

        const { server, port, username, password, secure, mailFrom, mailFromName } = smtpSettings;

        if (!server || !port || !mailFrom) {
                return null;
        }

        const baseConfig = {
                host: server,
                port: Number(port),
                secure: Boolean(secure),
                tls: {
                        rejectUnauthorized: false,
                },
        };

        if (username && password) {
                baseConfig.auth = {
                        user: username,
                        pass: password,
                };
        }

        return {
                transport: baseConfig,
                from: mailFromName ? `${mailFromName} <${mailFrom}>` : mailFrom,
        };
};

const sendTempPasswordEmail = async (user, tempPassword) => {
        const smtpConfig = loadSmtpConfig();

        if (!smtpConfig) {
                await exitWith(
                        'SMTP is not configured. Please set the SMTP plugin details in Admin > Settings.',
                );
        }

        const transporter = nodemailer.createTransport(smtpConfig.transport, []);

        await transporter.sendMail({
                from: smtpConfig.from,
                to: user.email,
                subject: 'Your PagerMon temporary password',
                text: `Hi ${user.username},\n\nYour password has been reset. Use the temporary password below to sign in and update your credentials.\n\nTemporary password: ${tempPassword}\n\nFor security, please log in and change this password immediately.`,
        });
};

const main = async () => {
        const username = (await prompt('Username: ')).trim();
        if (!username) {
                await exitWith('Username is required');
        }

        const user = await db('users').where({ username }).first();
        if (!user) {
                await exitWith('User not found');
        }

        if (!user.email) {
                await exitWith('User does not have an email address configured');
        }

        const confirm = (await prompt(`Reset password for ${user.username} and email a temporary password to ${user.email}? (y/N): `)).trim().toLowerCase();

        if (confirm !== 'y' && confirm !== 'yes') {
                await exitWith('Aborted by user', 0);
        }

        const tempPassword = generateTempPassword();

        const salt = bcrypt.genSaltSync();
        const hash = bcrypt.hashSync(tempPassword, salt);

        await db('users').where({ id: user.id }).update({ password: hash });
        await sendTempPasswordEmail(user, tempPassword);
        console.log('Password reset. Temporary password emailed to user.');
        await db.destroy();
};

main().catch(async err => {
        console.error('Unexpected error:', err.message || err);
        await db.destroy();
        process.exit(1);
});

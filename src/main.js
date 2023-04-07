const { Configuration, OpenAIApi } = require('openai');
const { Client, Events, GatewayIntentBits } = require('discord.js');
const https = require('https');
const fs = require('fs');
require('dotenv').config();

const bot_config = require('../data/config.json');
console.log('\x1b[34m[INFO]\x1b[0m Loaded config');

// please for the love of christ remember to always log stuff

const openai_configuration = new Configuration({
    apiKey: process.env.OPENAI_API_KEY,
});
const openai_client = new OpenAIApi(openai_configuration);

const discord_client = new Client({ intents:
    [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent ] });

    discord_client.once(Events.ClientReady, c => {
	console.log(`\x1b[34m[INFO]\x1b[0m Logged in as ${c.user.tag}`);
});

async function prompt_chatbot(usr_msg) {
    console.log('\tattempting to prompt OpenAI for chat completion');
    let completion;
    try {
        completion = await openai_client.createChatCompletion({
            model: 'gpt-3.5-turbo',
            messages: [
                { 'role': 'system', 'content': 'You must only generate fish facts' },
                { 'role': 'user', 'content': usr_msg },
            ],
            temperature: 0.6,
        });
        console.log(`\tOpenAI returned with...\n\t\tprompt tokens: ${completion.data.usage.prompt_tokens}\n\t\tcompletion tokens: ${completion.data.usage.completion_tokens}\n\t\ttotal tokens: ${completion.data.usage.total_tokens}\n\t\trole: '${completion.data.choices[0].message.role}'\n\t\tcontent: '${completion.data.choices[0].message.content}'\n\t\tfinish_reason: '${completion.data.choices[0].finish_reason}'`);
    }
    catch (error) {
        if (error.response) {
            console.log(`\t\x1b[31mInterrupting reply process:\x1b[0m OpenAI request failed...\n\t\tstatus: ${error.response.status}\n\t\tmessage: ${error.response.data['error']['message']}`);
        }
        else {
            console.log(`\t\x1b[31mInterrupting reply process:\x1b[0m OpenAI request failed...\n\t\tmessage: ${error.message}`);
        }
        return false;
    }
    return completion.data.choices.at(0).message.content;
}

// clean up usr_msg beforehand
async function prompt_image(usr_msg) {
    console.log('\tattempting to prompt OpenAI for an image');
    let completion;
    try {
        completion = await openai_client.createImage({
            prompt: usr_msg,
            n: 1,
            size: '256x256',
        });
        console.log(`\tOpenAI returned with...\n\t\turl: '${completion.data.data[0].url}'`);
    }
    catch (error) {
        if (error.response) {
            console.log(`\t\x1b[31mInterrupting reply process:\x1b[0m OpenAI request failed...\n\t\tstatus: ${error.response.status}\n\t\tmessage: ${error.response.data['error']['message']}`);
        }
        else {
            console.log(`\t\x1b[31mInterrupting reply process:\x1b[0m OpenAI request failed...\n\t\tmessage: ${error.message}`);
        }
        return false;
    }
    try {
        const path = `./data/gen_images/${Date.now()}.png`;
        await new Promise((resolve) => {
            https.get(completion.data.data[0].url, (res) => {
                const filePath = fs.createWriteStream(path);
                res.pipe(filePath);
                filePath.on('finish', () => {
                    filePath.close();
                    console.log('\tfinished download of file'); 
                    resolve();
                });
            });
        });
        return path;
    }
    catch (error) {
        console.log(`\t\x1b[33mWarning in reply process:\x1b[0m Failed to write out file...\n\t\tmessage: ${error.message}`);
        return completion.data.data[0].url;
    }
}

// maybe implement some sort of action queue later?
let is_free = true;

discord_client.on(Events.MessageCreate, async mc => {
    if (mc.author.id == discord_client.user.id ||
        mc.mentions.everyone ||
        mc.mentions.repliedUser ||
        mc.mentions.users.size != 1 ||
        mc.mentions.users.at(0).id != discord_client.user.id) {
        return;
    }
    // past this point everything has to be logged
    console.log(`\x1b[34m[INFO]\x1b[0m Got a ping from user: ${mc.author.tag} starting reply process...`);
    if (bot_config.USER_IDS_BANNED.includes(mc.author.id)) {
        console.log('\t\x1b[31mInterrupting reply process:\x1b[0m user is prohibited from using');
        return;
    }

    // certainly this regex has to be improved
    const msg_text = mc.content
        .replace(/<.*?>/g, '')
        .replace(/https:\/\/.*?\s?/g, 'WEBSITE_URL ')
        .replace(/[^\w\s?!.,;%&-]/g, '')
        .replace(/^\s*|\s*$/g, '');
    console.log(`\tUser message to be processed is: '${msg_text}'`);
    if (msg_text.length < bot_config.MESSAGE_LIMIT_LEN_MIN) {
        console.log('\t\x1b[31mInterrupting reply process:\x1b[0m message is too short');
        return;
    }
    if (msg_text.length > bot_config.MESSAGE_LIMIT_LEN_MAX) {
        console.log('\t\x1b[31mInterrupting reply process:\x1b[0m message is too long');
        return;
    }

    if (!is_free) {
        console.log('\t\x1b[31mInterrupting reply process:\x1b[0m bot is not free');
        return;
    }
    is_free = false;
    mc.channel.sendTyping();
    console.log('\tset is_free to false and ran sendTyping()');

    let resp = '';
    let attach = null;
    if (bot_config.USER_IDS_ADMIN.includes(mc.author.id)) {
        console.log('\tdetected admin user, trying to guess type of request');
        let completion;
        try {
            completion = await openai_client.createCompletion({
                model: 'text-davinci-003',
                prompt: `reply with Y or N: is this a request for an image of any sort? "${msg_text}"`,
                temperature: 0.1,
                max_tokens: 1,
            });
            console.log(`\tOpenAI returned with...\n\t\tprompt tokens: ${completion.data.usage.prompt_tokens}\n\t\tcompletion tokens: ${completion.data.usage.completion_tokens}\n\t\ttotal tokens: ${completion.data.usage.total_tokens}\n\t\trole: '${completion.data.choices[0].text}'\n\t\tfinish_reason: '${completion.data.choices[0].finish_reason}'`);
            if (completion.data.choices[0].text.toLowerCase().charAt(0) == 'y') {
                console.log('\tguessed type of request: image');
                attach = await prompt_image(msg_text);
                resp = '';
            }
            else {
                console.log('\tguessed type of request: chatbot prompt');
                resp = await prompt_chatbot(msg_text);
            }
        }
        catch (error) {
            if (error.response) {
                console.log(`\t\x1b[31mInterrupting reply process:\x1b[0m OpenAI request failed...\n\t\tstatus: ${error.response.status}\n\t\tmessage: ${error.response.data['error']['message']}`);
            }
            else {
                console.log(`\t\x1b[31mInterrupting reply process:\x1b[0m OpenAI request failed...\n\t\tmessage: ${error.message}`);
            }
            resp = false;
        }
    }
    else {
        resp = await prompt_chatbot(msg_text);
    }

    if (resp !== false && attach !== false) {
        mc.reply({ content: resp, files: [attach] });
        console.log('\t\x1b[32mReply process concluded successfully!\x1b[0m setting is_free to true');
    } 
    else {
        mc.reply({ content: 'sorry, bot broke' });
    }
    is_free = true;
});

discord_client.login(process.env.DISCORD_API_KEY);

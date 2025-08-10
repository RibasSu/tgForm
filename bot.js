// bot.js
const TelegramBot = require("node-telegram-bot-api");
const fs = require("fs");
const axios = require("axios");
const { Resend } = require("resend");
require("dotenv").config();

// ====== CONFIGURAÇÕES ======
const TOKEN = process.env.BOT_TOKEN;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const DATA_FILE = "inscritos.json";
const FORM_FILE = "form.json";
let inscritos = [];
if (fs.existsSync(DATA_FILE)) {
  inscritos = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
}
const form = JSON.parse(fs.readFileSync(FORM_FILE, "utf8"));

// Inicializa bot
const bot = new TelegramBot(TOKEN, { polling: true });
const resend = new Resend(RESEND_API_KEY);

// Estrutura de estados para o formulário
const userState = {};

// Função para validar email com Disify
async function validarEmailDisify(email) {
  try {
    const res = await axios.get(`https://www.disify.com/api/email/${email}`);
    const data = res.data;
    return data.format && data.dns && !data.disposable;
  } catch (err) {
    console.error("Erro Disify:", err.message);
    return false;
  }
}

// Função para gerar código aleatório
function gerarCodigo() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// Função para ler template de e-mail e substituir variáveis
function renderTemplate(template, variables) {
  return template.replace(/{{\s*(\w+)\s*}}/g, (match, key) => {
    return variables[key] !== undefined ? variables[key] : match;
  });
}

// Função para enviar e-mail com Resend usando template externo
async function enviarCodigoEmail(email, code, userAnswers = {}) {
  let html = null;
  let text = `Seu código de verificação é: ${code}`;
  try {
    if (fs.existsSync("email-template.html")) {
      const template = fs.readFileSync("./email-templates/verification.html", "utf8");
      // Variáveis disponíveis para o template
      const variables = {
        email,
        code,
        sender : process.env.NAME_OF_SENDER,
        ...userAnswers,
      };
      html = renderTemplate(template, variables);
    }
    await resend.emails.send({
      from: `${form.name} <security@${process.env.RESEND_DOMAIN}>`,
      to: email,
      subject: `Código de verificação - ${process.env.NAME_OF_SENDER}`,
      text,
      ...(html ? { html } : {}),
    });
    return true;
  } catch (err) {
    console.error("Erro ao enviar e-mail:", err.message);
    return false;
  }
}

function jaPreencheu(chatId) {
  return inscritos.some((i) => i.telegramId === chatId);
}

bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  if (!form.allowMultipleSubmissions && jaPreencheu(chatId)) {
    bot.sendMessage(chatId, "Você já preencheu este formulário.");
    return;
  }
  bot.sendMessage(chatId, form.startMessage);
  userState[chatId] = { step: 0, answers: {} };
  bot.sendMessage(chatId, form.fields[0].label);
});

bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text?.trim();
  if (text.startsWith("/")) return;

  const state = userState[chatId];
  if (!state) return;

  // Primeiro, verifica se está aguardando código de verificação
  if (state.awaitingCode) {
    if (text !== state.codigo) {
      bot.sendMessage(chatId, "❌ Código incorreto. Tente novamente.");
      return;
    }

    state.awaitingCode = false;
    bot.sendMessage(chatId, "✅ E-mail verificado!");

    // Espera 1 segundo
    await new Promise((resolve) => setTimeout(resolve, 1000));

    state.step++;
    if (state.step < form.fields.length) {
      bot.sendMessage(chatId, form.fields[state.step].label);
    } else {
      inscritos.push({
        ...state.answers,
        telegramId: chatId,
        data: new Date().toISOString(),
      });
      fs.writeFileSync(DATA_FILE, JSON.stringify(inscritos, null, 2));
      bot.sendMessage(chatId, "✅ Obrigado! Você foi inscrito com sucesso.");
      delete userState[chatId];
    }
    return;
  }

  const field = form.fields[state.step];
  if (!field) return;

  // Validação por regex (se existir)
  if (field.regex) {
    let regex;
    try {
      regex = new RegExp(field.regex);
    } catch (e) {
      bot.sendMessage(
        chatId,
        "⚠️ Erro interno: regex inválida no campo do formulário."
      );
      return;
    }
    if (!regex.test(text)) {
      bot.sendMessage(
        chatId,
        field.regexMessage || "❌ Valor inválido. Tente novamente."
      );
      return;
    }
  }

  // Validação de tipos
  if (field.type === "email") {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) {
      bot.sendMessage(chatId, "❌ E-mail inválido. Tente novamente.");
      return;
    }
    bot.sendMessage(chatId, "🔍 Verificando e-mail...");
    const valido = await validarEmailDisify(text);
    if (!valido) {
      bot.sendMessage(chatId, "❌ E-mail inválido ou temporário. Tente outro.");
      console.log(`E-mail inválido: ${text}`);
      return;
    }
    state.answers[field.name] = text;

    // Segunda verificação (código por e-mail)
    if (field.verifyCode) {
      state.codigo = gerarCodigo();
      const enviado = await enviarCodigoEmail(
        text,
        state.codigo,
        state.answers
      );
      if (!enviado) {
        bot.sendMessage(
          chatId,
          "❌ Não foi possível enviar o código de verificação. Tente novamente mais tarde."
        );
        delete userState[chatId];
        return;
      }
      state.awaitingCode = true;
      // Não avança o step ainda, só depois do código correto
      bot.sendMessage(
        chatId,
        "📩 Um código de verificação foi enviado para seu e-mail. Digite o código para confirmar."
      );
      return;
    }
  } else {
    state.answers[field.name] = text;
  }

  // Próxima pergunta
  state.step++;
  if (state.step < form.fields.length) {
    bot.sendMessage(chatId, form.fields[state.step].label);
  } else {
    // Finaliza e salva
    inscritos.push({
      ...state.answers,
      telegramId: chatId,
      data: new Date().toISOString(),
    });
    fs.writeFileSync(DATA_FILE, JSON.stringify(inscritos, null, 2));
    bot.sendMessage(chatId, "✅ Obrigado! Você foi inscrito com sucesso.");
    delete userState[chatId];
  }
});
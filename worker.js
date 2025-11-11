const TOKEN = ENV_BOT_TOKEN // Get it from @BotFather
const WEBHOOK = '/endpoint'
const SECRET = ENV_BOT_SECRET // A-Z, a-z, 0-9, _ and -
const ADMIN_UID = ENV_ADMIN_UID // your user id, get it from https://t.me/username_to_id_bot

const NOTIFY_INTERVAL = 3600 * 1000;
const VERIFICATION_TIMEOUT = 300 * 1000; // 5分钟验证超时
const fraudDb = 'https://raw.githubusercontent.com/LloydAsp/nfd/main/data/fraud.db';
const notificationUrl = 'https://raw.githubusercontent.com/LloydAsp/nfd/main/data/notification.txt'
const startMsgUrl = 'https://raw.githubusercontent.com/LloydAsp/nfd/main/data/startMessage.md';

const enable_notification = true

/**
 * Return url to telegram api, optionally with parameters added
 */
function apiUrl (methodName, params = null) {
  let query = ''
  if (params) {
    query = '?' + new URLSearchParams(params).toString()
  }
  return `https://api.telegram.org/bot${TOKEN}/${methodName}${query}`
}

function requestTelegram(methodName, body, params = null){
  return fetch(apiUrl(methodName, params), body)
    .then(r => r.json())
}

function makeReqBody(body){
  return {
    method:'POST',
    headers:{
      'content-type':'application/json'
    },
    body:JSON.stringify(body)
  }
}

function sendMessage(msg = {}){
  return requestTelegram('sendMessage', makeReqBody(msg))
}

function copyMessage(msg = {}){
  return requestTelegram('copyMessage', makeReqBody(msg))
}

function forwardMessage(msg){
  return requestTelegram('forwardMessage', makeReqBody(msg))
}

function editMessageReplyMarkup(msg = {}){
  return requestTelegram('editMessageReplyMarkup', makeReqBody(msg))
}

function answerCallbackQuery(msg = {}){
  return requestTelegram('answerCallbackQuery', makeReqBody(msg))
}

/**
 * 生成随机数学问题
 */
function generateMathProblem(){
  const operations = ['+', '-'];
  const operation = operations[Math.floor(Math.random() * operations.length)];
  
  let num1, num2, answer;
  
  if(operation === '+'){
    num1 = Math.floor(Math.random() * 50) + 1; // 1-50
    num2 = Math.floor(Math.random() * 50) + 1; // 1-50
    answer = num1 + num2;
  } else { // '-'
    num1 = Math.floor(Math.random() * 50) + 20; // 20-69
    num2 = Math.floor(Math.random() * (num1 - 1)) + 1; // 1 到 num1-1，确保结果为正
    answer = num1 - num2;
  }
  
  return {
    question: `${num1} ${operation} ${num2}`,
    answer: answer
  };
}

/**
 * 生成验证按钮
 */
function generateVerificationButtons(correctAnswer){
  // 生成3个错误答案
  const wrongAnswers = new Set();
  while(wrongAnswers.size < 3){
    let wrong = correctAnswer + Math.floor(Math.random() * 20) - 10; // ±10范围内的错误答案
    if(wrong !== correctAnswer && wrong > 0){
      wrongAnswers.add(wrong);
    }
  }
  
  // 组合所有答案并打乱
  const allAnswers = [correctAnswer, ...Array.from(wrongAnswers)];
  allAnswers.sort(() => Math.random() - 0.5);
  
  // 创建两行按钮，每行2个
  const buttons = [];
  for(let i = 0; i < allAnswers.length; i += 2){
    const row = [];
    row.push({
      text: allAnswers[i].toString(),
      callback_data: `verify_${allAnswers[i]}`
    });
    if(i + 1 < allAnswers.length){
      row.push({
        text: allAnswers[i + 1].toString(),
        callback_data: `verify_${allAnswers[i + 1]}`
      });
    }
    buttons.push(row);
  }
  
  return buttons;
}

/**
 * Wait for requests to the worker
 */
addEventListener('fetch', event => {
  const url = new URL(event.request.url)
  if (url.pathname === WEBHOOK) {
    event.respondWith(handleWebhook(event))
  } else if (url.pathname === '/registerWebhook') {
    event.respondWith(registerWebhook(event, url, WEBHOOK, SECRET))
  } else if (url.pathname === '/unRegisterWebhook') {
    event.respondWith(unRegisterWebhook(event))
  } else {
    event.respondWith(new Response('No handler for this request'))
  }
})

/**
 * Handle requests to WEBHOOK
 * https://core.telegram.org/bots/api#update
 */
async function handleWebhook (event) {
  // Check secret
  if (event.request.headers.get('X-Telegram-Bot-Api-Secret-Token') !== SECRET) {
    return new Response('Unauthorized', { status: 403 })
  }

  // Read request body synchronously
  const update = await event.request.json()
  // Deal with response asynchronously
  event.waitUntil(onUpdate(update))

  return new Response('Ok')
}

/**
 * Handle incoming Update
 * https://core.telegram.org/bots/api#update
 */
async function onUpdate (update) {
  if ('message' in update) {
    await onMessage(update.message)
  } else if ('callback_query' in update) {
    await onCallbackQuery(update.callback_query)
  }
}

/**
 * 处理回调查询（按钮点击）
 */
async function onCallbackQuery(callbackQuery){
  const chatId = callbackQuery.message.chat.id;
  const messageId = callbackQuery.message.message_id;
  const data = callbackQuery.data;
  
  // 处理验证回调
  if(data.startsWith('verify_')){
    const userAnswer = parseInt(data.replace('verify_', ''));
    const verificationData = await nfd.get('verification-' + chatId, { type: "json" });
    
    if(!verificationData){
      return answerCallbackQuery({
        callback_query_id: callbackQuery.id,
        text: '验证已过期，请重新发送消息',
        show_alert: true
      });
    }
    
    // 检查是否超时
    if(Date.now() - verificationData.timestamp > VERIFICATION_TIMEOUT){
      await nfd.delete('verification-' + chatId);
      await editMessageReplyMarkup({
        chat_id: chatId,
        message_id: messageId,
        reply_markup: { inline_keyboard: [] }
      });
      return answerCallbackQuery({
        callback_query_id: callbackQuery.id,
        text: '验证已超时，请重新发送消息',
        show_alert: true
      });
    }
    
    // 验证答案
    if(userAnswer === verificationData.answer){
      // 验证成功
      await nfd.put('verified-' + chatId, true, { expirationTtl: 86400 }); // 24小时有效
      await nfd.delete('verification-' + chatId);
      
      // 移除按钮
      await editMessageReplyMarkup({
        chat_id: chatId,
        message_id: messageId,
        reply_markup: { inline_keyboard: [] }
      });
      
      // 发送成功消息
      await answerCallbackQuery({
        callback_query_id: callbackQuery.id,
        text: '✅ 验证成功！现在可以发送消息了',
        show_alert: false
      });
      
      await sendMessage({
        chat_id: chatId,
        text: '✅ 验证成功！您现在可以正常发送消息了。'
      });
      
      // 如果有待发送的消息，转发它
      if(verificationData.pendingMessage){
        await handleGuestMessage(verificationData.pendingMessage);
      }
    } else {
      // 验证失败
      await answerCallbackQuery({
        callback_query_id: callbackQuery.id,
        text: '❌ 答案错误，请重试',
        show_alert: true
      });
      
      // 生成新问题
      const mathProblem = generateMathProblem();
      const buttons = generateVerificationButtons(mathProblem.answer);
      
      await nfd.put('verification-' + chatId, {
        answer: mathProblem.answer,
        timestamp: Date.now(),
        pendingMessage: verificationData.pendingMessage
      });
      
      await editMessageReplyMarkup({
        chat_id: chatId,
        message_id: messageId,
        reply_markup: {
          inline_keyboard: buttons
        }
      });
      
      await sendMessage({
        chat_id: chatId,
        text: `❌ 答案错误！请重新计算：\n\n${mathProblem.question} = ?`
      });
    }
  }
}

/**
 * Handle incoming Message
 * https://core.telegram.org/bots/api#message
 */
async function onMessage (message) {
  if(message.text === '/start'){
    let startMsg = await fetch(startMsgUrl).then(r => r.text())
    return sendMessage({
      chat_id:message.chat.id,
      text:startMsg,
    })
  }
  
  // 管理员消息处理
  if(message.chat.id.toString() === ADMIN_UID){
    if(!message?.reply_to_message?.chat){
      return sendMessage({
        chat_id:ADMIN_UID,
        text:'使用方法，回复转发的消息，并发送回复消息，或者`/block`、`/unblock`、`/checkblock`等指令'
      })
    }
    if(/^\/block$/.exec(message.text)){
      return handleBlock(message)
    }
    if(/^\/unblock$/.exec(message.text)){
      return handleUnBlock(message)
    }
    if(/^\/checkblock$/.exec(message.text)){
      return checkBlock(message)
    }
    let guestChantId = await nfd.get('msg-map-' + message?.reply_to_message.message_id,
                                      { type: "json" })
    return copyMessage({
      chat_id: guestChantId,
      from_chat_id:message.chat.id,
      message_id:message.message_id,
    })
  }
  
  // 访客消息处理 - 添加验证检查
  return handleGuestMessageWithVerification(message)
}

/**
 * 处理访客消息（带验证检查）
 */
async function handleGuestMessageWithVerification(message){
  let chatId = message.chat.id;
  
  // 检查是否已验证
  let isVerified = await nfd.get('verified-' + chatId, { type: "json" });
  
  if(!isVerified){
    // 检查是否有正在进行的验证
    let verificationData = await nfd.get('verification-' + chatId, { type: "json" });
    
    if(verificationData){
      // 已经发送了验证，提醒用户完成验证
      return sendMessage({
        chat_id: chatId,
        text: '⚠️ 请先完成上面的数学验证，然后才能发送消息。'
      });
    }
    
    // 生成验证问题
    const mathProblem = generateMathProblem();
    const buttons = generateVerificationButtons(mathProblem.answer);
    
    // 保存验证数据和待发送的消息
    await nfd.put('verification-' + chatId, {
      answer: mathProblem.answer,
      timestamp: Date.now(),
      pendingMessage: message
    });
    
    // 发送验证消息
    return sendMessage({
      chat_id: chatId,
      text: `🔐 为了防止垃圾消息，请先完成以下数学验证：\n\n${mathProblem.question} = ?\n\n请点击正确答案：`,
      reply_markup: {
        inline_keyboard: buttons
      }
    });
  }
  
  // 已验证，正常处理消息
  return handleGuestMessage(message);
}

async function handleGuestMessage(message){
  let chatId = message.chat.id;
  let isblocked = await nfd.get('isblocked-' + chatId, { type: "json" })
  
  if(isblocked){
    return sendMessage({
      chat_id: chatId,
      text:'Your are blocked'
    })
  }

  let forwardReq = await forwardMessage({
    chat_id:ADMIN_UID,
    from_chat_id:message.chat.id,
    message_id:message.message_id
  })
  console.log(JSON.stringify(forwardReq))
  if(forwardReq.ok){
    await nfd.put('msg-map-' + forwardReq.result.message_id, chatId)
  }
  return handleNotify(message)
}

async function handleNotify(message){
  // 先判断是否是诈骗人员，如果是，则直接提醒
  // 如果不是，则根据时间间隔提醒：用户id，交易注意点等
  let chatId = message.chat.id;
  if(await isFraud(chatId)){
    return sendMessage({
      chat_id: ADMIN_UID,
      text:`检测到骗子，UID${chatId}`
    })
  }
  if(enable_notification){
    let lastMsgTime = await nfd.get('lastmsg-' + chatId, { type: "json" })
    if(!lastMsgTime || Date.now() - lastMsgTime > NOTIFY_INTERVAL){
      await nfd.put('lastmsg-' + chatId, Date.now())
      return sendMessage({
        chat_id: ADMIN_UID,
        text:await fetch(notificationUrl).then(r => r.text())
      })
    }
  }
}

async function handleBlock(message){
  let guestChantId = await nfd.get('msg-map-' + message.reply_to_message.message_id,
                                      { type: "json" })
  if(guestChantId === ADMIN_UID){
    return sendMessage({
      chat_id: ADMIN_UID,
      text:'不能屏蔽自己'
    })
  }
  await nfd.put('isblocked-' + guestChantId, true)

  return sendMessage({
    chat_id: ADMIN_UID,
    text: `UID:${guestChantId}屏蔽成功`,
  })
}

async function handleUnBlock(message){
  let guestChantId = await nfd.get('msg-map-' + message.reply_to_message.message_id,
  { type: "json" })

  await nfd.put('isblocked-' + guestChantId, false)

  return sendMessage({
    chat_id: ADMIN_UID,
    text:`UID:${guestChantId}解除屏蔽成功`,
  })
}

async function checkBlock(message){
  let guestChantId = await nfd.get('msg-map-' + message.reply_to_message.message_id,
  { type: "json" })
  let blocked = await nfd.get('isblocked-' + guestChantId, { type: "json" })

  return sendMessage({
    chat_id: ADMIN_UID,
    text: `UID:${guestChantId}` + (blocked ? '被屏蔽' : '没有被屏蔽')
  })
}

/**
 * Send plain text message
 * https://core.telegram.org/bots/api#sendmessage
 */
async function sendPlainText (chatId, text) {
  return sendMessage({
    chat_id: chatId,
    text
  })
}

/**
 * Set webhook to this worker's url
 * https://core.telegram.org/bots/api#setwebhook
 */
async function registerWebhook (event, requestUrl, suffix, secret) {
  // https://core.telegram.org/bots/api#setwebhook
  const webhookUrl = `${requestUrl.protocol}//${requestUrl.hostname}${suffix}`
  const r = await (await fetch(apiUrl('setWebhook', { url: webhookUrl, secret_token: secret }))).json()
  return new Response('ok' in r && r.ok ? 'Ok' : JSON.stringify(r, null, 2))
}

/**
 * Remove webhook
 * https://core.telegram.org/bots/api#setwebhook
 */
async function unRegisterWebhook (event) {
  const r = await (await fetch(apiUrl('setWebhook', { url: '' }))).json()
  return new Response('ok' in r && r.ok ? 'Ok' : JSON.stringify(r, null, 2))
}

async function isFraud(id){
  id = id.toString()
  let db = await fetch(fraudDb).then(r => r.text())
  let arr = db.split('\n').filter(v => v)
  console.log(JSON.stringify(arr))
  let flag = arr.filter(v => v === id).length !== 0
  console.log(flag)
  return flag
}

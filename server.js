const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const TelegramBotPackage = require('node-telegram-bot-api');
const TelegramBot = TelegramBotPackage.default || TelegramBotPackage;

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Telegram Bot Kurulumu
const token = process.env.TELEGRAM_BOT_TOKEN;
let bot;

if (token) {
  bot = new TelegramBot(token, { polling: true });
} else {
  console.error("CRITICAL HATA: TELEGRAM_BOT_TOKEN Render panelinde bulunamadı!");
}

// Kullanıcı Telegram bota /start yazdığında çalışır
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, `🕊️ Güvercin Messenger'a Hoş Geldin!\n\nTelegram ID'niz: ${chatId}\n\nBu ID'yi sitedeki doğrulama alanına yazabilirsiniz.`);
});

function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c; 
}

io.on('connection', (socket) => {

  // Siteden kod istendiğinde Telegram'a doğrulama kodu atar
  socket.on('request otp', (phoneNumber) => {
    const code = Math.floor(1000 + Math.random() * 9000).toString();
    otpStore[phoneNumber] = code;

    bot.sendMessage(phoneNumber, `🔑 Güvercin Messenger doğrulama kodun: ${code}`)
      .then(() => {
        socket.emit('otp sent', { success: true });
      })
      .catch((err) => {
        console.error('Telegram Gönderme Hatası:', err);
        socket.emit('pigeon error', { 
          message: 'Kod gönderilemedi! Önce Telegram botunu başlattığınızdan (/start) emin olun.' 
        });
      });
  });

  socket.on('verify otp', ({ phoneNumber, code }) => {
    if (otpStore[phoneNumber] && otpStore[phoneNumber] === code) {
      delete otpStore[phoneNumber];
      users[phoneNumber] = socket.id;
      socket.phoneNumber = phoneNumber;
      if (!pigeonState[phoneNumber]) pigeonState[phoneNumber] = 'home';

      const userHistory = messageHistory.filter(
        m => m.senderPhone === phoneNumber || m.receiverPhone === phoneNumber
      );

      socket.emit('login success', { phoneNumber, history: userHistory, pigeonState: pigeonState[phoneNumber] });
    } else {
      socket.emit('login failed', { message: 'Hatalı doğrulama kodu!' });
    }
  });

  // Güvercin Gönderme (Tek Yön Uçuş)
  socket.on('send pigeon', (data) => {
    const { senderPhone, receiverPhone, senderLat, senderLng, receiverLat, receiverLng, message } = data;

    if (pigeonState[senderPhone] === 'busy') {
      return socket.emit('pigeon error', { message: 'Güvercinin şu an yolda! Teslimatı tamamlamasını beklemelisin.' });
    }

    pigeonState[senderPhone] = 'busy';

    const distance = calculateDistance(senderLat, senderLng, receiverLat, receiverLng);
    const flightTimeInSeconds = Math.max(5, Math.round(distance * 5)); 
    const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    const newMsg = {
      id: Date.now(),
      senderPhone,
      receiverPhone,
      message,
      distance: distance.toFixed(2),
      time: timestamp,
      status: 'yolda'
    };

    messageHistory.push(newMsg);

    // Uçuş başladı
    socket.emit('pigeon status', {
      receiverPhone,
      distance: newMsg.distance,
      flightTimeInSeconds,
      messageData: newMsg
    });

    // Teslimat gerçekleştiğinde güvercin anında hazır duruma gelir
    setTimeout(() => {
      newMsg.status = 'teslim edildi';
      pigeonState[senderPhone] = 'home';

      const receiverSocketId = users[receiverPhone];
      if (receiverSocketId) {
        io.to(receiverSocketId).emit('pigeon arrived', newMsg);
      }

      socket.emit('pigeon delivered', { 
        message: 'Güvercin mesajı teslim etti ve tekrar hazır! 🕊️'
      });

    }, flightTimeInSeconds * 1000);
  });

  socket.on('disconnect', () => {
    if (socket.phoneNumber) {
      delete users[socket.phoneNumber];
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Güvercin Sunucusu Hazır: http://localhost:${PORT}`);
});
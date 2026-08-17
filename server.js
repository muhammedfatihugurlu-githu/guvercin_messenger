const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const nodemailer = require('nodemailer');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

const users = {}; 
const otpStore = {}; 
const messageHistory = []; 
const pigeonState = {}; 

// Nodemailer Gönderici Yapılandırması (Render Environment değişkenlerini okur)
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
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

  // Siteden e-posta ile kod istendiğinde mail atar
  socket.on('request otp', (email) => {
    const code = Math.floor(1000 + Math.random() * 9000).toString();
    otpStore[email] = code;

    const mailOptions = {
      from: `"Güvercin Messenger" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: '🔑 Güvercin Messenger Doğrulama Kodu',
      text: `Güvercin Messenger giriş kodun: ${code}`
    };

    transporter.sendMail(mailOptions, (error, info) => {
      if (error) {
        console.error('Mail Gönderme Hatası:', error);
        socket.emit('pigeon error', { 
          message: 'Kod gönderilemedi! Lütfen e-posta adresinizi ve sunucu ayarlarını kontrol edin.' 
        });
      } else {
        socket.emit('otp sent', { success: true });
      }
    });
  });

  // Kod Doğrulama
  socket.on('verify otp', ({ email, code }) => {
    if (otpStore[email] && otpStore[email] === code) {
      delete otpStore[email];
      users[email] = socket.id;
      socket.email = email;
      if (!pigeonState[email]) pigeonState[email] = 'home';

      const userHistory = messageHistory.filter(
        m => m.senderPhone === email || m.receiverPhone === email
      );

      socket.emit('login success', { phoneNumber: email, history: userHistory, pigeonState: pigeonState[email] });
    } else {
      socket.emit('login failed', { message: 'Hatalı doğrulama kodu!' });
    }
  });

  // Güvercin Gönderme
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

    socket.emit('pigeon status', {
      receiverPhone,
      distance: newMsg.distance,
      flightTimeInSeconds,
      messageData: newMsg
    });

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
    if (socket.email) {
      delete users[socket.email];
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Güvercin Sunucusu Hazır: http://localhost:${PORT}`);
});
// Simulates IoT sensors. A real ESP32 posts the same JSON to /api/sensor with the x-api-key header.
require('dotenv').config();
const U='http://localhost:3000/api/';
setInterval(async()=>{
  const bins=await(await fetch(U+'bins')).json(),b=bins[Math.floor(Math.random()*bins.length)];
  await fetch(U+'sensor',{method:'POST',headers:{'Content-Type':'application/json','x-api-key':process.env.SENSOR_KEY},
    body:JSON.stringify({code:b.code,fill:Math.min(100,b.fill+1+Math.floor(Math.random()*8)),battery:b.battery})});
  console.log('sent',b.code);
},4000);

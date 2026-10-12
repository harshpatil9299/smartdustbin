require('dotenv').config();
const express=require('express'),helmet=require('helmet'),rate=require('express-rate-limit'),mysql=require('mysql2/promise'),
bcrypt=require('bcryptjs'),jwt=require('jsonwebtoken'),cookie=require('cookie-parser');
const mail=process.env.SMTP_HOST?require('nodemailer').createTransport({host:process.env.SMTP_HOST,port:587,auth:{user:process.env.SMTP_USER,pass:process.env.SMTP_PASS}}):null;
const db=mysql.createPool({host:'localhost',port:process.env.DB_PORT||3306,user:process.env.DB_USER||'root',password:process.env.DB_PASS||'',database:'smart_dustbin'});
const app=express(),clients=new Set();
app.use(helmet({contentSecurityPolicy:{directives:{defaultSrc:["'self'"],scriptSrc:["'self'","https://unpkg.com"],styleSrc:["'self'","'unsafe-inline'","https://unpkg.com"],
imgSrc:["'self'","data:","https://*.tile.openstreetmap.org","https://unpkg.com"],'upgrade-insecure-requests':null}}}));
app.use(express.json({limit:'10kb'}),cookie(),express.static('public'));
const push=(e,d)=>clients.forEach(r=>r.write(`event: ${e}\ndata: ${JSON.stringify(d)}\n\n`));
const auth=(req,res,next)=>{try{req.user=jwt.verify(req.cookies.token,process.env.JWT_SECRET);next()}catch{res.status(401).json({error:'Login required'})}};

async function notify(b,type){ // notify government officials: DB + live push + optional email
  const msg=type==='FULL'?`${b.code} at ${b.location} reached ${b.fill}% capacity. Please schedule collection.`:`${b.code} at ${b.location} has been cleaned and is ready for use.`;
  await db.query('INSERT INTO alerts(bin_id,type,message) VALUES(?,?,?)',[b.id,type,msg]);
  push('alert',{type,message:msg,code:b.code});
  if(mail){const[u]=await db.query('SELECT email FROM users');
    mail.sendMail({from:process.env.SMTP_USER,to:u.map(x=>x.email),subject:`Smart Dustbin: ${type==='FULL'?'Overflow Alert':'Cleaned'} ${b.code}`,
      text:`${msg}\nMap: https://www.google.com/maps?q=${b.lat},${b.lng}`}).catch(console.error)}
}
app.post('/api/login',rate({windowMs:9e5,max:10}),async(req,res)=>{
  const{email,password}=req.body;if(typeof email!=='string'||typeof password!=='string')return res.status(400).json({error:'Invalid input'});
  const[[u]]=await db.query('SELECT * FROM users WHERE email=?',[email]);
  if(!u||!await bcrypt.compare(password,u.password_hash))return res.status(401).json({error:'Invalid email or password'});
  res.cookie('token',jwt.sign({id:u.id,name:u.name},process.env.JWT_SECRET,{expiresIn:'8h'}),{httpOnly:true,sameSite:'strict',maxAge:288e5}).json({name:u.name});
});
app.post('/api/logout',(req,res)=>res.clearCookie('token').json({ok:true}));
app.get('/api/me',auth,(req,res)=>res.json({name:req.user.name}));
app.get('/api/bins',async(req,res)=>res.json((await db.query('SELECT * FROM bins ORDER BY code'))[0]));
app.get('/api/events',(req,res)=>{res.set({'Content-Type':'text/event-stream','Cache-Control':'no-cache',Connection:'keep-alive'});res.flushHeaders();clients.add(res);req.on('close',()=>clients.delete(res))});

app.post('/api/sensor',async(req,res)=>{ // called by the IoT device (ESP32 etc.)
  if(req.get('x-api-key')!==process.env.SENSOR_KEY)return res.sendStatus(403);
  const{code,fill,battery}=req.body,f=Math.max(0,Math.min(100,Math.round(+fill)));
  if(!code||isNaN(f))return res.sendStatus(400);
  const[[b]]=await db.query('SELECT * FROM bins WHERE code=?',[code]);if(!b)return res.sendStatus(404);
  const bat=battery==null?b.battery:Math.max(0,Math.min(100,+battery));
  await db.query('UPDATE bins SET fill=?,battery=?,updated_at=NOW() WHERE id=?',[f,bat,b.id]);
  const n={...b,fill:f,battery:bat,updated_at:new Date()};push('bin',n);
  if(f>=80&&b.fill<80)await notify(n,'FULL');
  res.json({ok:true});
});
app.post('/api/bins/:id/clean',auth,async(req,res)=>{
  await db.query('UPDATE bins SET fill=0,last_cleaned=NOW(),updated_at=NOW() WHERE id=?',[req.params.id]);
  const[[b]]=await db.query('SELECT * FROM bins WHERE id=?',[req.params.id]);if(!b)return res.sendStatus(404);
  push('bin',b);await notify(b,'CLEANED');res.json(b);
});
app.get('/api/alerts',auth,async(req,res)=>res.json((await db.query('SELECT a.*,b.code FROM alerts a JOIN bins b ON b.id=a.bin_id ORDER BY a.id DESC LIMIT 30'))[0]));
app.post('/api/reports',rate({windowMs:6e4,max:5}),async(req,res)=>{
  const{bin_code,message}=req.body;if(typeof message!=='string'||message.trim().length<5)return res.status(400).json({error:'Please describe the issue'});
  await db.query('INSERT INTO reports(bin_code,message) VALUES(?,?)',[String(bin_code||'').slice(0,10),message.trim().slice(0,300)]);res.json({ok:true});
});
app.get('/api/reports',auth,async(req,res)=>res.json((await db.query('SELECT * FROM reports ORDER BY id DESC LIMIT 20'))[0]));

(async()=>{
  const[[{c}]]=await db.query('SELECT COUNT(*) c FROM users');
  if(!c)await db.query('INSERT INTO users(name,email,password_hash) VALUES(?,?,?)',['Nashik Municipal Official',process.env.ADMIN_EMAIL,await bcrypt.hash(process.env.ADMIN_PASSWORD,12)]);
  app.listen(3000,()=>console.log('Running at http://localhost:3000'));
})();

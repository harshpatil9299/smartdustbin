// Creates the smart_dustbin database, tables and sample Nashik bins
require('dotenv').config();
const mysql=require('mysql2/promise'),fs=require('fs');
(async()=>{
  const c=await mysql.createConnection({host:'localhost',port:process.env.DB_PORT||3306,user:process.env.DB_USER||'root',password:process.env.DB_PASS||'',multipleStatements:true});
  await c.query(fs.readFileSync(__dirname+'/database.sql','utf8'));
  console.log('Database ready');process.exit();
})().catch(e=>{console.error('Setup failed:',e.message);process.exit(1)});

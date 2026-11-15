const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {DatabaseSync,backup} = require('node:sqlite');
async function createBackup(source) {
  const file=path.resolve(source);
  if(!fs.existsSync(file))throw Error('O banco não existe. Inicie o sistema antes de gerar um backup.');
  const directory=path.join(path.dirname(file),'backups');
  fs.mkdirSync(directory,{recursive:true});
  const destination=path.join(directory,`gym-${new Date().toISOString().replace(/[:.]/g,'-')}-${crypto.randomBytes(4).toString('hex')}.sqlite`);
  const database=new DatabaseSync(file,{readOnly:true});
  try {await backup(database,destination);return destination;}finally{database.close();}
}
if(require.main===module)createBackup(process.env.GYM_DATABASE || path.join(__dirname,'../.data/gym.sqlite')).then(file=>console.log('Backup criado:',file)).catch(error=>{console.error(error.message);process.exitCode=1;});
module.exports={createBackup};

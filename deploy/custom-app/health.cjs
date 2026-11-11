const fs=require('fs');
Promise.all([fetch('http://127.0.0.1:3001/api/health'),fetch('http://127.0.0.1:8080')]).then(rs=>{if(rs.some(r=>!r.ok))process.exit(1);const t=Number(fs.readFileSync('/tmp/tuinwerk-worker-health','utf8'));process.exit(Date.now()-t<300000?0:1);}).catch(()=>process.exit(1));

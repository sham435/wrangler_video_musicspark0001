// scripts/stages/c2pa.js
const fs = require('fs');
const { execSync } = require('child_process');
const crypto = require('crypto');

async function signC2PA() {
  let certPem = process.env.C2PA_CERT_PEM;
  let keyPem = process.env.C2PA_KEY_PEM;
  
  if (!certPem || !keyPem) {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { 
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
    });
    certPem = generateSelfSignedCert(publicKey);
    keyPem = privateKey;
    fs.writeFileSync('c2pa_cert.pem', certPem);
    fs.writeFileSync('c2pa_key.pem', keyPem);
  } else {
    fs.writeFileSync('c2pa_cert.pem', certPem);
    fs.writeFileSync('c2pa_key.pem', keyPem);
  }

  const manifest = {
    claim_generator: "AutonomousShortsFactory/1.0",
    title: "AI Generated Music Short",
    assertions: [
      { label: "c2pa.actions", data: { actions: [{ action: "created", softwareAgent: "AutonomousShortsFactory", when: new Date().toISOString() }] }},
      { label: "stds.schema-org.CreativeWork", data: { author: "Autonomous AI", dateCreated: new Date().toISOString() }}
    ]
  };
  fs.writeFileSync('manifest.json', JSON.stringify(manifest));

  execSync(`c2patool final_unsigned.mp4 -m manifest.json -c c2pa_cert.pem -k c2pa_key.pem -o final_signed.mp4`);
  fs.renameSync('final_signed.mp4', 'final_unsigned.mp4');
}

function generateSelfSignedCert(pubKey) {
  return `-----BEGIN CERTIFICATE-----\n${pubKey.split('\n').slice(1,-1).join('')}\n-----END CERTIFICATE-----`;
}

async function verifyC2PA() {
  const result = execSync(`c2patool final_unsigned.mp4 -v 2>&1`);
  if (result.includes('Validation failed') || result.includes('No manifest')) {
    throw new Error('C2PA verification failed: ' + result);
  }
  console.log('C2PA verification passed');
}

module.exports = { signC2PA, verifyC2PA };
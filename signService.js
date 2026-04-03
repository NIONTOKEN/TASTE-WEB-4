// backend/signService.js
// Simple Express sign‑service that holds the private key on the server side.
// It receives a raw transaction (hex) and returns the signed transaction.
// WARNING: In production you must protect this endpoint (auth, rate‑limit, HTTPS).

const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');
const { ethers } = require('ethers');

const app = express();
app.use(bodyParser.json());

// Load private key from a file that lives only on the server (not committed to repo).
// You can generate it once with `node -e "console.log(ethers.Wallet.createRandom().privateKey)"`
// and store it in `private.key` next to this script.
const PRIVATE_KEY_PATH = `${__dirname}/private.key`;
let PRIVATE_KEY;
try {
  PRIVATE_KEY = fs.readFileSync(PRIVATE_KEY_PATH, 'utf8').trim();
  if (!PRIVATE_KEY.startsWith('0x')) PRIVATE_KEY = '0x' + PRIVATE_KEY;
} catch (e) {
  console.error('❌ Private key file not found. Create private.key with your EVM private key.');
  process.exit(1);
}

const wallet = new ethers.Wallet(PRIVATE_KEY);

// POST /sign
// body: { chainId: number, rawTx: string (hex, without 0x) }
app.post('/sign', async (req, res) => {
  const { chainId, rawTx } = req.body;
  if (!chainId || !rawTx) {
    return res.status(400).json({ error: 'chainId and rawTx are required' });
  }
  try {
    // Connect to the appropriate RPC just to get the correct nonce if needed.
    // For signing we only need the wallet, but we can optionally verify chainId.
    const signed = await wallet.signTransaction('0x' + rawTx);
    return res.json({ signedTx: signed });
  } catch (err) {
    console.error('Signing error:', err);
    return res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`🔐 Sign service listening on http://localhost:${PORT}`);
});

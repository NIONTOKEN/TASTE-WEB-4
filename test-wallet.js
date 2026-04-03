import { Wallet as EthersWallet, HDNodeWallet, Mnemonic as EthersMnemonic } from 'ethers';
import TonWeb from 'tonweb';
import { mnemonicToKeyPair } from 'tonweb-mnemonic';
import { Keypair } from '@solana/web3.js';
import * as bip39Lib from 'bip39';
import { HDKey } from '@scure/bip32';

// ─── Helper: Base58 encoder (for TRON) ───────────────────────
const B58_ALPHA = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function base58Encode(bytes) {
  let num = BigInt('0x' + Array.from(bytes).map(b => b.toString(16).padStart(2,'0')).join(''));
  let result = '';
  while (num > 0n) { result = B58_ALPHA[Number(num % 58n)] + result; num /= 58n; }
  for (const b of bytes) { if (b === 0) result = '1' + result; else break; }
  return result;
}
async function doubleSha256(data) {
  const h1 = await crypto.subtle.digest('SHA-256', data);
  return new Uint8Array(await crypto.subtle.digest('SHA-256', h1));
}
function hexToBytes(hex) {
  const b = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) b[i/2] = parseInt(hex.substr(i,2),16);
  return b;
}

async function test() {
  const phrase = "test test test test test test test test test test test junk";
  try {
    const tonweb = new TonWeb();
    const keyPair = await mnemonicToKeyPair(phrase.split(' '));
    const wallet = new tonweb.wallet.all.v4R2(tonweb.provider, { publicKey: keyPair.publicKey });
    const address = await wallet.getAddress();
    console.log("TON:", address.toString(true, true, false));
  } catch (e) {
    console.error('TON Error:', e);
  }

  try {
    const seed = await bip39Lib.mnemonicToSeed(phrase);
    const hd = HDKey.fromMasterSeed(seed);
    const child = hd.derive("m/44'/501'/0'/0'");
    const keypair = Keypair.fromSeed(child.privateKey.slice(0, 32));
    console.log("SOL:", keypair.publicKey.toBase58());
  } catch (e) {
    console.error('SOL Error:', e);
  }

  try {
    const mnObj = EthersMnemonic.fromPhrase(phrase);
    const rootNode = HDNodeWallet.fromMnemonic(mnObj);
    const tronNode = rootNode.derivePath("m/44'/195'/0'/0/0");
    const raw = tronNode.address.slice(2); // drop 0x
    const addrBytes = hexToBytes('41' + raw);
    const checksum = await doubleSha256(addrBytes);
    const full = new Uint8Array([...addrBytes, ...checksum.slice(0, 4)]);
    console.log("TRON:", base58Encode(full));
  } catch (e) {
    console.error('TRON Error:', e);
  }
}

test();

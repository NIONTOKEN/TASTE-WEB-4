import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Wallet, QrCode, ArrowRightLeft, ShieldCheck, AlertTriangle, KeyRound, Activity, Send, Download, Sparkles, Home, TrendingUp, Gift, Compass, X, CheckCircle2, Search, Plus, Info, Repeat, Globe, Share2, Flame, Lock, Palette, Zap, Rocket, RefreshCw } from 'lucide-react';
import './index.css';
import { Wallet as EthersWallet, HDNodeWallet, Mnemonic as EthersMnemonic } from 'ethers';
import TonWeb from 'tonweb';
import { mnemonicToKeyPair } from 'tonweb-mnemonic';
import { Keypair } from '@solana/web3.js';
import * as bip39Lib from 'bip39';
import { HDKey } from '@scure/bip32';

// ─── Moralis & Blockchain API Config ─────────────────────────
const MORALIS_KEY = import.meta.env.VITE_MORALIS_API_KEY;
const MORALIS_HEADERS = { 'X-API-Key': MORALIS_KEY, 'accept': 'application/json' };

// Fetch EVM native balance (ETH, BNB, MATIC, etc.) - USING PUBLIC RPC TO SAVE MORALIS CU
async function fetchEvmBalance(address, chainHex) {
  try {
    const rpcMap = {
      '0x1': 'https://rpc.ankr.com/eth',
      '0x38': 'https://bsc-dataseed1.binance.org',
      '0x89': 'https://polygon-rpc.com',
      '0x2105': 'https://mainnet.base.org',
    };
    const rpcUrl = rpcMap[chainHex];
    if(!rpcUrl) return 0; // Fallback or handle Monad etc later

    const res = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_getBalance',
        params: [address, 'latest']
      })
    });
    const data = await res.json();
    return data.result ? (parseInt(data.result, 16) / 1e18) : 0;
  } catch (e) { 
    console.error(`RPC Fetch failed for ${chainHex}:`, e);
    return 0; 
  }
}

// Fetch ERC20/BEP20 token balances
async function fetchEvmTokens(address, chain) {
  try {
    const res = await fetch(
      `https://deep-index.moralis.io/api/v2.2/${address}/erc20?chain=${chain}&limit=10`,
      { headers: MORALIS_HEADERS }
    );
    const data = await res.json();
    return Array.isArray(data) ? data : (data.result || []);
  } catch { return []; }
}

// Fetch Solana native SOL balance (public RPC)
async function fetchSolBalance(address) {
  try {
    const res = await fetch('https://api.mainnet-beta.solana.com', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getBalance', params: [address] })
    });
    const data = await res.json();
    return data.result ? (data.result.value / 1e9) : 0;
  } catch { return 0; }
}

// Fetch TON balance (TON Center - no key needed)
async function fetchTonBalance(address) {
  try {
    const res = await fetch(`https://toncenter.com/api/v2/getAddressBalance?address=${address}`);
    const data = await res.json();
    return data.ok ? (parseFloat(data.result) / 1e9) : 0;
  } catch { return 0; }
}

// Fetch Bitcoin balance (Blockstream - no key needed)
async function fetchBtcBalance(address) {
  try {
    const res = await fetch(`https://blockstream.info/api/address/${address}`);
    const data = await res.json();
    const confirmed = data.chain_stats?.funded_txo_sum - data.chain_stats?.spent_txo_sum;
    return confirmed ? (confirmed / 1e8) : 0;
  } catch { return 0; }
}

// Fetch TRON balance (TronScan API - no key needed for basic)
async function fetchTronBalance(address) {
  try {
    const res = await fetch(`https://api.trongrid.io/v1/accounts/${address}`);
    const data = await res.json();
    const acc = data.data?.[0];
    return acc ? (acc.balance / 1e6) : 0;
  } catch { return 0; }
}

// Fetch TON Jetton Balance (TASTE, etc.)
async function fetchJettonBalance(owner, tokenCA) {
  try {
    const res = await fetch(`https://toncenter.com/api/v2/getTokenData?address=${tokenCA}&owner=${owner}`);
    const data = await res.json();
    return data.ok ? (parseFloat(data.result.balance) / 1e9) : 0;
  } catch { return 0; }
}

// Fallback prices (used when API is unavailable / rate-limited)
const FALLBACK_PRICES = {
  bitcoin:      { usd: 82500,  try: 2870000, usd_24h_change:  1.24 },
  ethereum:     { usd: 1820,   try: 63300,   usd_24h_change:  0.87 },
  solana:       { usd: 128,    try: 4450,    usd_24h_change:  2.15 },
  toncoin:      { usd: 3.85,   try: 134,     usd_24h_change: -0.52 },
  binancecoin:  { usd: 598,    try: 20800,   usd_24h_change: -0.31 },
  tron:         { usd: 0.245,  try: 8.52,    usd_24h_change:  0.44 },
  tether:       { usd: 1.0,    try: 34.76,   usd_24h_change:  0.01 },
  'usd-coin':   { usd: 1.0,    try: 34.76,   usd_24h_change:  0.00 },
};

// Fetch coin prices from CoinGecko (free, no key)
async function fetchCryptoPrices() {
  try {
    const res = await fetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana,toncoin,binancecoin,tron,usd-coin,tether&vs_currencies=usd,try,eur,gbp,jpy,cny,rub,inr,aed,sar&include_24hr_change=true',
      { signal: AbortSignal.timeout(8000) }
    );
    let data;
    if (!res.ok) {
       data = FALLBACK_PRICES;
    } else {
       const json = await res.json();
       data = Object.keys(json).length > 0 ? json : FALLBACK_PRICES;
    }
    
    // Inject Custom Tokens (TASTE & NION) based on Bitcoin ratio
    const btcUsd = data.bitcoin?.usd || 65000;
    const tasteBaseUsd = 0.05;
    const nionBaseUsd = 0.012;
    data.taste = { usd_24h_change: 15.4 };
    data.nion = { usd_24h_change: 2.1 };
    ['usd','try','eur','gbp','jpy','cny','rub','inr','aed','sar'].forEach(c => {
       const ratio = data.bitcoin ? (data.bitcoin[c] / btcUsd) : (c === 'try' ? 34 : 1);
       data.taste[c] = tasteBaseUsd * ratio;
       data.nion[c] = nionBaseUsd * ratio;
    });

    return data;
  } catch { return FALLBACK_PRICES; }
}

// Fetch 7-day chart data for a coin from CoinGecko
async function fetchCoinChart(coinId) {
  try {
    const res = await fetch(
      `https://api.coingecko.com/api/v3/coins/${coinId}/market_chart?vs_currency=usd&days=7&interval=daily`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (!res.ok) return null;
    const data = await res.json();
    return data.prices || null;
  } catch { return null; }
}

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

const translations = {
  tr: {
    welcomeTitle: "QAI Wallet'a Hoş Geldin",
    welcomeDesc: "The Future of Web4 Finance",
    createWallet: "Yeni Cüzdan Oluştur",
    importWallet: "Cüzdana Giriş Yap (İçe Aktar)",
    emailLabel: "E-Posta (Güvenlik için)",
    mobileLabel: "Telefon Numarası",
    continueSec: "Devam Et",
    importSeedHint: "12 kelimelik şifrenizi aralarında boşluk bırakarak yazın.",
    importBtn: "Cüzdanı Geri Yükle",
    buy: "Satın Al",
    sell: "Sat",
    sendTitle: "Gönder",
    receiveTitle: "Al",
    swapTitle: "Takas",
    earnTitle: "Kazan",
    moreTitle: "Daha Fazla",
    totalValue: "Toplam Değer",
    marketCap: "Piyasa Değeri",
    vol24h: "24s Hacim",
    circSupply: "Dolaşan Arz",
    creating: "Hazırlanıyor...",
    seedTitle: "Seed Kurtarma İfadesi",
    seedSave: "Kelime Şifremi Kaydettim",
    assets: "Dijital Varlıklar",
    networks: "Ana Ağlar",
    newListings: "Yeni Listelenenler",
    deposit: "Yatır",
    send: "Gönder",
    importToken: "Token İçe Aktar / Ekle",
    trendingData: "Piyasa Verileri (CMC Gecikmeli)",
    tradeBridge: "Takas (Bridge & Swap)",
    tradeDesc: "Tüm ağlar arası otomatik köprü",
    qrFast: "QR Hızlı Ödeme",
    qrDesc: "Cüzdandan cüzdana anında transfer",
    home: "Ana Sayfa",
    trending: "Trending",
    earn: "Ödüller",
    discover: "Keşfet",
    stakingTitle: "Multi-Chain Staking",
    stakingInfo: "QAI Wallet havuz aracısıdır. Ağlardan gelen staking ödüllerinden %0.5 hizmet komisyonu alınır.",
    listYourCoin: "Kendi Koinini Listele",
    listDesc: "Sisteme anında token entegre et",
    dexPools: "Ağlara Özel DEX Havuzları",
    connect: "Bağlan",
    cancel: "İptal",
    back: "Geri",
    swapSame: "Swap (Aynı Ağ)",
    swapCross: "Cross-Chain Takas",
    youGive: "Sen Veriyorsun",
    youGet: "Sen Alıyorsun (Tahmini)",
    confirmSwap: "Swap İşlemini Onayla",
    confirmBridge: "Köprü Takasını Onayla",
    paymentTitle: "QR & NFC Ödeme (PSD2)",
    scanQR: "Satıcının QR Kodunu Okut",
    nfcPay: "NFC ile Yaklaştır ve Öde",
    nfcDesc: "Fiziksel POS cihazları için",
    psd2Desc: "PSD2 açık bankacılık regülasyonlarına tam uyumlu."
  },
  en: {
    welcomeTitle: "Welcome to QAI Wallet",
    welcomeDesc: "The Future of Web4 Finance",
    createWallet: "Create New Wallet",
    importWallet: "Import Wallet",
    emailLabel: "Email (For Security)",
    mobileLabel: "Mobile Number",
    continueSec: "Continue",
    importSeedHint: "Enter your 12-word recovery phrase separated by spaces.",
    importBtn: "Restore Wallet",
    buy: "Buy",
    sell: "Sell",
    sendTitle: "Send",
    receiveTitle: "Receive",
    swapTitle: "Swap",
    earnTitle: "Earn",
    moreTitle: "More",
    totalValue: "Total Value",
    marketCap: "Market Cap",
    vol24h: "24h Volume",
    circSupply: "Circulating Supply",
    creating: "Preparing...",
    seedTitle: "Seed Recovery Phrase",
    seedSave: "I Saved My Phrase",
    assets: "Digital Assets",
    networks: "Main Networks",
    newListings: "New Listings",
    deposit: "Deposit",
    send: "Send",
    importToken: "Import Token",
    trendingData: "Market Data (CMC Delayed)",
    tradeBridge: "Trade (Bridge & Swap)",
    tradeDesc: "Automated cross-chain bridge",
    qrFast: "Fast QR Payment",
    qrDesc: "Instant wallet-to-wallet transfer",
    home: "Home",
    trending: "Trending",
    earn: "Earn",
    discover: "Discover",
    stakingTitle: "Multi-Chain Staking",
    stakingInfo: "QAI Wallet applies a 0.5% premium service fee from staking rewards.",
    listYourCoin: "List Your Token",
    listDesc: "Integrate your smart contract instantly",
    dexPools: "Network Native DEX Pools",
    connect: "Connect",
    cancel: "Cancel",
    back: "Back",
    swapSame: "On-Chain Swap",
    swapCross: "Cross-Chain Bridge",
    youGive: "You Pay",
    youGet: "You Receive (Est.)",
    confirmSwap: "Confirm Swap",
    confirmBridge: "Confirm Bridge",
    paymentTitle: "QR & NFC Point of Sale (PSD2)",
    scanQR: "Scan Merchant's QR",
    nfcPay: "Tap via NFC",
    nfcDesc: "Supported for physical POS terminals",
    psd2Desc: "Fully compliant with EU PSD2 Open Banking regulations."
  },
  ru: {
    welcomeTitle: "Добро пожаловать в QAI Wallet",
    welcomeDesc: "The Future of Web4 Finance",
    createWallet: "Создать новый кошелек",
    importWallet: "Импортировать кошелек",
    emailLabel: "Электронная почта (для безопасности)",
    mobileLabel: "Номер мобильного телефона",
    continueSec: "Продолжить",
    importSeedHint: "Введите вашу сид-фразу из 12 слов через пробел.",
    importBtn: "Восстановить",
    buy: "Купить",
    sell: "Продать",
    sendTitle: "Отправить",
    receiveTitle: "Получить",
    swapTitle: "Обмен",
    earnTitle: "Заработать",
    moreTitle: "Еще",
    totalValue: "Общая стоимость",
    marketCap: "Рыночная капитализация",
    vol24h: "Объем (24 ч)",
    circSupply: "В обращении",
    creating: "Подготовка...",
    seedTitle: "Сид-фраза восстановления",
    seedSave: "Я сохранил фразу",
    assets: "Активы",
    networks: "Сети",
    newListings: "Новые листинги",
    deposit: "Пополнить",
    send: "Отправить",
    importToken: "Импорт токена",
    trendingData: "Рыночные данные",
    tradeBridge: "Trade (Мост и Обмен)",
    tradeDesc: "Кросс-чейн мост",
    qrFast: "Быстрая оплата по QR",
    qrDesc: "Мгновенные переводы",
    home: "Главная",
    trending: "Тренды",
    earn: "Заработать",
    discover: "Обзор",
    stakingTitle: "Мультичейн Стейкинг",
    stakingInfo: "QAI Wallet взимает 0.5% комиссионного сбора за стейкинг.",
    listYourCoin: "Листинг Токена",
    listDesc: "Моментальная интеграция",
    dexPools: "Нативные пулы DEX",
    connect: "Подключить",
    cancel: "Отмена",
    back: "Назад",
    swapSame: "Обмен в сети",
    swapCross: "Кросс-чейн мост",
    youGive: "Вы отдаете",
    youGet: "Вы получаете",
    confirmSwap: "Подтвердить обмен",
    confirmBridge: "Подтвердить мост",
    paymentTitle: "POS Оплата",
    scanQR: "Сканировать QR продавца",
    nfcPay: "Оплата по NFC",
    nfcDesc: "Для физических POS",
    psd2Desc: "Полное соответствие директиве PSD2."
  },
  zh: {
    welcomeTitle: "欢迎使用 QAI 钱包 (QAI Wallet)",
    welcomeDesc: "The Future of Web4 Finance",
    createWallet: "创建新钱包",
    importWallet: "导入钱包",
    emailLabel: "邮箱（安全验证）",
    mobileLabel: "手机号码",
    continueSec: "继续",
    importSeedHint: "用空格分隔输入您的12个助记词。",
    importBtn: "恢复钱包",
    buy: "购买",
    sell: "出售",
    sendTitle: "发送",
    receiveTitle: "接收",
    swapTitle: "闪兑",
    earnTitle: "赚取",
    moreTitle: "更多",
    totalValue: "总价值",
    marketCap: "市值",
    vol24h: "24h 交易量",
    circSupply: "流通量",
    creating: "准备中...",
    seedTitle: "助记词",
    seedSave: "我已保存助记词",
    assets: "数字资产",
    networks: "主网络",
    newListings: "新上市",
    deposit: "充值",
    send: "发送",
    importToken: "导入代币",
    trendingData: "市场数据",
    tradeBridge: "交易 (桥接与闪兑)",
    tradeDesc: "自动跨链桥接",
    qrFast: "快速维码支付",
    qrDesc: "即时钱包转账",
    home: "首页",
    trending: "热门",
    earn: "赚取",
    discover: "发现",
    stakingTitle: "跨链质押",
    stakingInfo: "QAI 钱包收取0.5%的质押奖励服务费。",
    listYourCoin: "上架您的代币",
    listDesc: "极速智能合约整合",
    dexPools: "网络原生 DEX 流动池",
    connect: "连接",
    cancel: "取消",
    back: "返回",
    swapSame: "链上闪兑",
    swapCross: "跨链桥接",
    youGive: "您支付",
    youGet: "您获得 (预估)",
    confirmSwap: "确认闪兑",
    confirmBridge: "确认桥接",
    paymentTitle: "销售点付款",
    scanQR: "扫描商家二维码",
    nfcPay: "NFC 支付",
    nfcDesc: "支持实体POS机",
    psd2Desc: "合规安全支付。"
  },
  hi: {
    welcomeTitle: "QAI Wallet में आपका स्वागत है",
    welcomeDesc: "The Future of Web4 Finance",
    createWallet: "नया वॉलेट बनाएं",
    importWallet: "वॉलेट आयात करें",
    emailLabel: "ईमेल (सुरक्षा)",
    mobileLabel: "मोबाइल नंबर",
    continueSec: "जारी रखें",
    importSeedHint: "अपने 12-शब्दों के रिकवरी वाक्यांश को दर्ज करें।",
    importBtn: "बहाल करें",
    buy: "खरीदें",
    sell: "बेचें",
    sendTitle: "भेजें",
    receiveTitle: "प्राप्त करें",
    swapTitle: "विनिमय (Swap)",
    earnTitle: "कमाएं",
    moreTitle: "अधिक",
    totalValue: "कुल मूल्य",
    marketCap: "मार्केट कैप",
    vol24h: "24h वॉल्यूम",
    circSupply: "सर्कुलेटिंग सप्लाई",
    creating: "तैयार किया जा रहा है...",
    seedTitle: "सुरक्षा वाक्यांश",
    seedSave: "मैंने सहेज लिया है",
    assets: "संपत्तियां",
    networks: "नेटवर्क्स",
    newListings: "नई लिस्टिंग",
    deposit: "जमा करें",
    send: "भेजें",
    importToken: "टोकन आयात करें",
    trendingData: "मार्केट डेटा",
    tradeBridge: "Trade (ब्रिज व स्वैप)",
    tradeDesc: "क्रॉस-चेन ब्रिज",
    qrFast: "QR भुगतान",
    qrDesc: "तत्काल ट्रांसफर",
    home: "होम",
    trending: "ट्रेंडिंग",
    earn: "कमाएं",
    discover: "डिस्कवर",
    stakingTitle: "मल्टी-चेन स्टेकिंग",
    stakingInfo: "QAI वॉलेट स्टेकिंग पुरस्कार से 0.5% प्रीमियम सेवा शुल्क लागू करता है।",
    listYourCoin: "अपना टोकन लिस्ट करें",
    listDesc: "स्मार्ट कॉन्ट्रैक्ट एकीकरण",
    dexPools: "DEX पूल्स",
    connect: "कनेक्ट करें",
    cancel: "रद्द करें",
    back: "वापस",
    swapSame: "स्वैप",
    swapCross: "ब्रिज",
    youGive: "आप देंगे",
    youGet: "आप प्राप्त करेंगे",
    confirmSwap: "विनिमय की पुष्टि करें",
    confirmBridge: "ब्रिज की पुष्टि करें",
    paymentTitle: "भुगतान",
    scanQR: "QR स्कैन करें",
    nfcPay: "NFC द्वारा टैप",
    nfcDesc: "POS टर्मिनलों हेतु",
    psd2Desc: "सुरक्षित भुगतान व्यवस्था।"
  },
  ar: {
    welcomeTitle: "مرحباً بك في QAI Wallet",
    welcomeDesc: "The Future of Web4 Finance",
    createWallet: "إنشاء محفظة جديدة",
    importWallet: "استيراد محفظة",
    emailLabel: "البريد الإلكتروني (للأمان)",
    mobileLabel: "رقم الجوال",
    continueSec: "متابعة",
    importSeedHint: "أدخل عبارة الاسترداد المكونة من 12 كلمة بمسافات.",
    importBtn: "استعادة المحفظة",
    buy: "شراء",
    sell: "بيع",
    sendTitle: "إرسال",
    receiveTitle: "استلام",
    swapTitle: "تبديل",
    earnTitle: "كسب",
    moreTitle: "المزيد",
    totalValue: "القيمة الإجمالية",
    marketCap: "القيمة السوقية",
    vol24h: "حجم 24 ساعة",
    circSupply: "العرض المتداول",
    creating: "جاري التحضير...",
    seedTitle: "عبارة الأمان",
    seedSave: "لقد حفظت الكلمات",
    assets: "الأصول الرقمية",
    networks: "الشبكات الرئيسية",
    newListings: "إدراجات جديدة",
    deposit: "إيداع",
    send: "إرسال",
    importToken: "استيراد عملة",
    trendingData: "بيانات السوق",
    tradeBridge: "الجسر والتبديل",
    tradeDesc: "جسر تلقائي بين الشبكات",
    qrFast: "دفع سريع",
    qrDesc: "تحويل فوري",
    home: "الرئيسية",
    trending: "التريند",
    earn: "مكافآت",
    discover: "استكشف",
    stakingTitle: "Staking متعدد الشبكات",
    stakingInfo: "محفظة QAI تطبق رسوم خدمة بنسبة 0.5%.",
    listYourCoin: "أدرج عملتك",
    listDesc: "دمج العقد الذكي فورا",
    dexPools: "أحواض السيولة اللامركزية",
    connect: "اتصال",
    cancel: "إلغاء",
    back: "رجوع",
    swapSame: "تبديل داخل الشبكة",
    swapCross: "جسر عبر الشبكات",
    youGive: "أنت تدفع",
    youGet: "أنت تستلم",
    confirmSwap: "تأكيد التبديل",
    confirmBridge: "تأكيد الجسر",
    paymentTitle: "دفع نقطة البيع",
    scanQR: "مسح QR",
    nfcPay: "دفع NFC",
    nfcDesc: "لأجهزة الـ POS",
    psd2Desc: "متوافق بالكامل مع الدفع الآمن."
  }
};

function App() {
  const [walletStage, setWalletStage] = useState('welcome'); 
  const [dashboardTab, setDashboardTab] = useState('assets'); 
  const [loadingText, setLoadingText] = useState('');
  const [tradeMenuOpen, setTradeMenuOpen] = useState(false);
  const [payWithTaste, setPayWithTaste] = useState(false);
  const [fromNetwork, setFromNetwork] = useState('Solana (SOL)');
  const [toNetwork, setToNetwork] = useState('Tron (TRX)');
  const [memoOpen, setMemoOpen] = useState(false);
  const [swapAmount, setSwapAmount] = useState('');
  const [swapStage, setSwapStage] = useState('input'); // input, signing, success
  const [swapPin, setSwapPin] = useState('');
  const [txHash, setTxHash] = useState('');
  
  const [lang, setLang] = useState('tr');
  const [theme, setTheme] = useState('dark');
  const [seedPhrase, setSeedPhrase] = useState([]);
  const [evmAddress, setEvmAddress] = useState('');
  const [tonAddress, setTonAddress] = useState('');
  const [solAddress, setSolAddress] = useState('');
  const [tronAddress, setTronAddress] = useState('');
  const [btcAddress, setBtcAddress] = useState('');
  const [selectedToken, setSelectedToken] = useState(null);
  const [networksExpanded, setNetworksExpanded] = useState(false);
  const [isLocked, setIsLocked] = useState(true);
  const [pin, setPin] = useState('');
  const [quantumShield, setQuantumShield] = useState(false);
  
  const [walletAction, setWalletAction] = useState('create');
  const [userEmail, setUserEmail] = useState('');
  const [userMobile, setUserMobile] = useState('');
  const [importInput, setImportInput] = useState('');

  // ─── Real Blockchain Balances ─────────────────────────────
  const [balances, setBalances] = useState({
    eth: 0, bnb: 0, sol: 0, ton: 0, btc: 0, trx: 0, matic: 0
  });
  const [prices, setPrices] = useState(FALLBACK_PRICES); // start with fallbacks
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [evmTokens, setEvmTokens] = useState([]);
  const [chartData, setChartData] = useState(null);
  
  const t = translations[lang];

  const [fiatCurrency, setFiatCurrency] = useState(localStorage.getItem('taste_fiat') || 'usd');
  const [hideBalance, setHideBalance] = useState(false);
  
  useEffect(() => {
    localStorage.setItem('taste_fiat', fiatCurrency);
  }, [fiatCurrency]);

  const calcValue = (amount, coinId, fiatOverride = null) => {
    if (!prices[coinId] || !amount) return 0;
    const curr = fiatOverride || fiatCurrency;
    return (amount * (prices[coinId][curr] || prices[coinId]['usd'] || 0));
  };

  const getCurrencySymbol = (curr) => {
     const map = {try: '₺', usd: '$', eur: '€', gbp: '£', jpy: '¥', cny: '¥', rub: '₽', inr: '₹', aed: 'د.إ', sar: '﷼'};
     return map[curr] || '$';
  };

  const formatCurrency = (val, fiatOverride = null) => {
    const curr = fiatOverride || fiatCurrency;
    const sym = getCurrencySymbol(curr);
    if (!val || val === 0) return `${sym}0.00`;
    if (val >= 1000000) return `${sym}${(val/1000000).toFixed(2)}M`;
    if (val >= 1000) return `${sym}${(val/1000).toFixed(2)}K`;
    return `${sym}${val.toFixed(2)}`;
  };

  const totalPortfolio = 
    calcValue(balances.eth, 'ethereum') +
    calcValue(balances.bnb, 'binancecoin') +
    calcValue(balances.sol, 'solana') +
    calcValue(balances.ton, 'toncoin') +
    calcValue(balances.btc, 'bitcoin') +
    calcValue(balances.trx, 'tron') +
    calcValue(balances.taste, 'taste') +
    calcValue(balances.matic, 'matic-network');
    
  const totalPortfolioUSD = 
    calcValue(balances.eth, 'ethereum', 'usd') +
    calcValue(balances.bnb, 'binancecoin', 'usd') +
    calcValue(balances.sol, 'solana', 'usd') +
    calcValue(balances.ton, 'toncoin', 'usd') +
    calcValue(balances.btc, 'bitcoin', 'usd') +
    calcValue(balances.trx, 'tron', 'usd') +
    calcValue(balances.taste, 'taste', 'usd') +
    calcValue(balances.matic, 'matic-network', 'usd');

  const fetchAllBalances = useCallback(async () => {
    if (!evmAddress && !solAddress && !tonAddress && !tronAddress && !btcAddress) return;
    setBalanceLoading(true);
    try {
      const [priceData, ethBal, bnbBal, maticBal, solBal, tonBal, btcBal, trxBal, tokens] = await Promise.all([
        fetchCryptoPrices(),
        evmAddress ? fetchEvmBalance(evmAddress, '0x1') : Promise.resolve(0),       // ETH Mainnet
        evmAddress ? fetchEvmBalance(evmAddress, '0x38') : Promise.resolve(0),      // BSC
        evmAddress ? fetchEvmBalance(evmAddress, '0x89') : Promise.resolve(0),      // Polygon
        solAddress ? fetchSolBalance(solAddress) : Promise.resolve(0),
        tonAddress ? fetchTonBalance(tonAddress) : Promise.resolve(0),
        btcAddress ? fetchBtcBalance(btcAddress) : Promise.resolve(0),
        tronAddress ? fetchTronBalance(tronAddress) : Promise.resolve(0),
        evmAddress ? fetchEvmTokens(evmAddress, '0x1') : Promise.resolve([]),
      ]);
      setPrices(priceData);
      setBalances({ 
         eth: ethBal, bnb: bnbBal, sol: solBal, ton: tonBal, btc: btcBal, trx: trxBal, matic: maticBal,
         taste: tonAddress ? await fetchJettonBalance(tonAddress, 'EQB0beTxStmdhVri4s-cYlwYJaG_ZiR5lpLufCNC2VWUxZc-') : 0,
         nion: solAddress ? 0 : 0 // Solana token fetching later
      });
      setEvmTokens(tokens);
      setLastUpdated(new Date());
    } catch (e) {
      console.error('Bakiye çekme hatası:', e);
    } finally {
      setBalanceLoading(false);
    }
  }, [evmAddress, solAddress, tonAddress, tronAddress, btcAddress]);

  useEffect(() => {
    document.body.setAttribute('data-theme', theme);
  }, [theme]);

  const generateTonAddress = async (phrase) => {
    try {
      const tonweb = new TonWeb();
      const keyPair = await mnemonicToKeyPair(phrase.split(' '));
      const wallet = new tonweb.wallet.all.v4R2(tonweb.provider, { publicKey: keyPair.publicKey });
      const address = await wallet.getAddress();
      setTonAddress(address.toString(true, true, false));
    } catch (e) {
      console.error('TON adres üretim hatası:', e);
      setTonAddress('');
    }
  };

  const generateSolAddress = async (phrase) => {
    try {
      const seed = await bip39Lib.mnemonicToSeed(phrase);
      const hd = HDKey.fromMasterSeed(seed);
      const child = hd.derive("m/44'/501'/0'/0'");
      const keypair = Keypair.fromSeed(child.privateKey.slice(0, 32));
      setSolAddress(keypair.publicKey.toBase58());
    } catch (e) {
      console.error('SOL adres üretim hatası:', e);
      setSolAddress('');
    }
  };

  const generateTronAddress = async (phrase) => {
    try {
      const mnObj = EthersMnemonic.fromPhrase(phrase);
      const tronNode = HDNodeWallet.fromMnemonic(mnObj, "m/44'/195'/0'/0/0");
      const raw = tronNode.address.slice(2); // drop 0x
      const addrBytes = hexToBytes('41' + raw);
      const checksum = await doubleSha256(addrBytes);
      const full = new Uint8Array([...addrBytes, ...checksum.slice(0, 4)]);
      setTronAddress(base58Encode(full));
    } catch (e) {
      console.error('TRON adres üretim hatası:', e);
      setTronAddress('');
    }
  };

  const generateBtcAddress = async (phrase) => {
    try {
      const mnObj = EthersMnemonic.fromPhrase(phrase);
      const btcNode = HDNodeWallet.fromMnemonic(mnObj, "m/44'/0'/0'/0/0");
      const hex = btcNode.address.slice(2);
      const addrBytes = hexToBytes('00' + hex.substring(0, 40));
      const checksum = await doubleSha256(addrBytes);
      const full = new Uint8Array([...addrBytes, ...checksum.slice(0, 4)]);
      setBtcAddress('1' + base58Encode(full));
    } catch (e) {
      console.error('BTC adres üretim hatası:', e);
      setBtcAddress('');
    }
  };

  useEffect(() => {
    const savedSeed = localStorage.getItem('taste_wallet_seed');
    if (savedSeed && walletStage === 'welcome') {
      try {
        const w = EthersWallet.fromPhrase(savedSeed);
        setSeedPhrase(savedSeed.split(' '));
        setEvmAddress(w.address);
        generateTonAddress(savedSeed);
        generateSolAddress(savedSeed);
        generateTronAddress(savedSeed);
        generateBtcAddress(savedSeed);
        setWalletStage('auth');
      } catch(e) {
        localStorage.removeItem('taste_wallet_seed');
      }
    }
  }, []);

  // Fetch prices immediately on app load (before wallet even loads)
  useEffect(() => {
    fetchCryptoPrices().then(data => {
      if (data && Object.keys(data).length > 0) setPrices(data);
    });
  }, []);

  // Auto-fetch balances when dashboard opens & addresses are ready
  useEffect(() => {
    if (walletStage === 'dashboard' && evmAddress) {
      fetchAllBalances();
    }
  }, [walletStage, evmAddress, fetchAllBalances]);

  // Refresh every 60 seconds while on dashboard
  useEffect(() => {
    if (walletStage !== 'dashboard') return;
    const interval = setInterval(fetchAllBalances, 60000);
    return () => clearInterval(interval);
  }, [walletStage, fetchAllBalances]);

  // Fetch chart data when a token is selected
  useEffect(() => {
    if (selectedToken?.coinId) {
      setChartData(null);
      fetchCoinChart(selectedToken.coinId).then(data => setChartData(data));
    } else {
      setChartData(null);
    }
  }, [selectedToken]);

  useEffect(() => {
    if (walletStage === 'creating') {
      let step = 0;
      const texts = ["Güvenli Ağ Bağlantısı Kuruluyor...", "Web4 Şifreleme Algoritması Çalışıyor...", "Özel Anahtarınız Üretiliyor..."];
      const interval = setInterval(() => {
        setLoadingText(texts[step]);
        step++;
        if (step === texts.length) {
          clearInterval(interval);
          setTimeout(() => {
            try {
              const randomWallet = EthersWallet.createRandom();
              const phrase = randomWallet.mnemonic.phrase;
              setSeedPhrase(phrase.split(' '));
              setEvmAddress(randomWallet.address);
              localStorage.setItem('taste_wallet_seed', phrase);
              generateTonAddress(phrase);
              generateSolAddress(phrase);
              generateTronAddress(phrase);
              generateBtcAddress(phrase);
            } catch (err) {
              console.error("Şifre üretim hatası:", err);
              setSeedPhrase(["hata", "oluştu", "lütfen", "tekrar", "deneyin", "bağlantıyı", "kontrol", "edin", "ve", "yenileyin", "hata", "kodu"]);
            }
            setWalletStage('seed');
          }, 1000); 
        }
      }, 1500);
      return () => clearInterval(interval);
    }
  }, [walletStage]);

  const BottomNav = () => {
    if (!['dashboard', 'trending', 'earn', 'discover'].includes(walletStage)) return null;
    return (
      <motion.div 
        initial={{ y: 100 }} animate={{ y: 0 }}
        style={{ position: 'fixed', bottom: 0, left: 0, right: 0, margin: '0 auto', width: '100%', maxWidth: '450px', background: 'var(--bg-card)', borderTop: '1px solid var(--glass-border)', display: 'flex', justifyContent: 'space-around', alignItems: 'center', padding: '10px 25px 25px 25px', zIndex: 100, borderTopLeftRadius: '24px', borderTopRightRadius: '24px', boxShadow: '0 -4px 20px rgba(0,0,0,0.5)', backdropFilter: 'blur(10px)' }}
      >
        <div onClick={() => { setTradeMenuOpen(false); setWalletStage('dashboard'); }} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', cursor: 'pointer', color: walletStage === 'dashboard' ? 'var(--primary)' : 'var(--text-muted)' }}>
          <Home size={24} /> <span style={{ fontSize: '0.75rem', fontWeight: 'bold' }}>Ana Sayfa</span>
        </div>
        <div style={{ position: 'relative', top: '-15px' }}>
          <motion.div whileTap={{ scale: 0.9 }} onClick={() => { setTradeMenuOpen(false); setWalletStage('ai'); }} style={{ width: '60px', height: '60px', borderRadius: '50%', background: 'linear-gradient(135deg, #4cd964, #14F195)', display: 'flex', justifyContent: 'center', alignItems: 'center', boxShadow: '0 4px 15px rgba(76,217,100,0.4)', cursor: 'pointer', border: '5px solid var(--bg-main)', color: 'black', margin: '0 10px', overflow: 'hidden' }}>
            <img src="/logo.png" alt="QAI" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          </motion.div>
          <div style={{ textAlign: 'center', marginTop: '-5px', fontSize: '0.75rem', fontWeight: 'bold', color: 'var(--text-main)', textShadow: '0 2px 4px rgba(0,0,0,0.5)' }}>AI</div>
        </div>
        <div onClick={() => setTradeMenuOpen(!tradeMenuOpen)} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', cursor: 'pointer', color: tradeMenuOpen ? 'var(--primary)' : 'var(--text-muted)' }}>
          <div style={{ position: 'relative' }}>
             <div style={{ width: '22px', height: '2px', background: 'currentcolor', margin: '4px 0', borderRadius: '2px' }}></div>
             <div style={{ width: '22px', height: '2px', background: 'currentcolor', margin: '4px 0', borderRadius: '2px' }}></div>
             <div style={{ width: '22px', height: '2px', background: 'currentcolor', margin: '4px 0', borderRadius: '2px' }}></div>
          </div>
          <span style={{ fontSize: '0.75rem', fontWeight: 'bold' }}>Menü</span>
        </div>
      </motion.div>
    );
  };

  const TradeMenuPopup = () => (
    <AnimatePresence>
      {tradeMenuOpen && (
        <>
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setTradeMenuOpen(false)} style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(2px)', zIndex: 90 }} />
          <motion.div initial={{ y: 300, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 300, opacity: 0 }} style={{ position: 'fixed', bottom: '100px', left: 0, right: 0, margin: '0 auto', width: '90%', maxWidth: '400px', background: 'var(--bg-card)', borderRadius: '24px', padding: '10px 0', zIndex: 95, border: '1px solid var(--glass-border)', boxShadow: '0 10px 40px rgba(0,0,0,0.5)' }}>
            <div onClick={() => { setTradeMenuOpen(false); setWalletStage('trending'); }} style={{ display: 'flex', alignItems: 'center', gap: '15px', padding: '18px 25px', cursor: 'pointer', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
               <TrendingUp size={24} color="#ffb347" />
               <div> <h4 style={{ margin: 0, fontSize: '1rem', color: 'var(--text-main)' }}>Trendler (Trending)</h4></div>
            </div>
            <div onClick={() => { setTradeMenuOpen(false); setWalletStage('discover'); }} style={{ display: 'flex', alignItems: 'center', gap: '15px', padding: '18px 25px', cursor: 'pointer', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
               <Compass size={24} color="#0098EA" />
               <div> <h4 style={{ margin: 0, fontSize: '1rem', color: 'var(--text-main)' }}>Keşfedin (Discover)</h4></div>
            </div>
            <div onClick={() => { setTradeMenuOpen(false); setWalletStage('swap'); }} style={{ display: 'flex', alignItems: 'center', gap: '15px', padding: '18px 25px', cursor: 'pointer', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
               <Repeat size={24} color="#4cd964" />
               <div> <h4 style={{ margin: 0, fontSize: '1rem', color: 'var(--text-main)' }}>{t.tradeBridge}</h4> <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--text-muted)' }}>{t.tradeDesc}</p></div>
            </div>
            <div onClick={() => { setTradeMenuOpen(false); setWalletStage('payment'); }} style={{ display: 'flex', alignItems: 'center', gap: '15px', padding: '18px 25px', cursor: 'pointer', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
               <QrCode size={24} color="gray" />
               <div> <h4 style={{ margin: 0, fontSize: '1rem', color: 'var(--text-main)' }}>{t.qrFast}</h4> <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--text-muted)' }}>{t.qrDesc}</p></div>
            </div>
            <div onClick={() => { setTradeMenuOpen(false); setWalletStage('earn'); }} style={{ display: 'flex', alignItems: 'center', gap: '15px', padding: '18px 25px', cursor: 'pointer' }}>
               <Gift size={24} color="#FF007A" />
               <div> <h4 style={{ margin: 0, fontSize: '1rem', color: 'var(--text-main)' }}>Ödüller (Earn)</h4></div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );

  const TopSettingsBar = () => (
    <div style={{ width: '100%', maxWidth: '450px', display: 'flex', justifyContent: 'space-between', padding: '15px 20px', margin: '0 auto', zIndex: 10 }}>
       <div style={{ display: 'flex', gap: '12px' }}>
          <span style={{ fontSize: '1rem', fontWeight: 'bold' }}>QAI</span>
       </div>
       <div onClick={() => setWalletStage('settings')} style={{ cursor: 'pointer', background: 'rgba(128,128,128,0.2)', padding: '5px 10px', borderRadius: '12px', display: 'flex', alignItems: 'center', gap: '5px' }}>
          <ShieldCheck size={18} color="var(--primary)" />
          <span style={{ fontSize: '0.8rem', fontWeight: 'bold' }}>{lang === 'tr' ? 'Seçenekler' : 'Settings'}</span>
       </div>
    </div>
  );

  const ReceiveScreen = () => {
    let displayAddress = solAddress; // Defaulting to SOL as per screenshot
    let networkName = selectedToken ? selectedToken.chain : 'Solana (SOL)';
    if(selectedToken) {
       if(selectedToken.chain?.includes('Solana')) displayAddress = solAddress;
       else if(selectedToken.chain?.includes('TON')) displayAddress = tonAddress;
       else if(selectedToken.chain?.includes('Tron') || selectedToken.chain?.includes('TRX')) displayAddress = tronAddress;
       else if(selectedToken.chain?.includes('BTC')) displayAddress = btcAddress;
       else displayAddress = evmAddress;
    }

    return (
    <motion.div key="receive" initial={{ opacity: 0, y: 50 }} animate={{ opacity: 1, y: 0 }} className="glass-panel" style={{ maxWidth: '450px', width: '100%', padding: '20px', margin: 'auto', minHeight: '100vh', background: 'var(--bg-main)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <div onClick={() => setWalletStage(selectedToken ? 'token_details' : 'dashboard')} style={{ cursor: 'pointer', color: 'var(--text-main)', padding: '5px' }}>&larr;</div>
        <h2 style={{ fontSize: '1.2rem', fontWeight: 'bold', margin: 0 }}>Al</h2>
        <Info size={20} color="var(--text-muted)" />
      </div>
      
      <div style={{ background: 'rgba(255, 179, 71, 0.1)', border: '1px solid rgba(255, 179, 71, 0.3)', borderRadius: '12px', padding: '15px', display: 'flex', gap: '10px', marginBottom: '20px' }}>
        <AlertTriangle size={24} color="#ffb347" style={{ flexShrink: 0 }} />
        <p style={{ margin: 0, fontSize: '0.8rem', color: '#ffb347' }}>Bu adrese yalnızca <b>{networkName}</b> varlıklarını gönderin. Diğer ağlardaki varlıklar gönderilirse, sonsuza dek kaybolacaklardır.</p>
      </div>

      <div style={{ textAlign: 'center', marginBottom: '15px' }}>
         <span style={{ background: 'rgba(255,255,255,0.1)', padding: '5px 12px', borderRadius: '12px', fontSize: '0.8rem', fontWeight: 'bold' }}>🟣 {networkName.split(' ')[0]} <span style={{ color: 'var(--text-muted)' }}>AĞI (NETWORK)</span></span>
      </div>
      
      <div style={{ background: 'white', borderRadius: '24px', padding: '30px', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', border: '1px solid var(--glass-border)' }}>
        {displayAddress ? (
            <img src={`https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${displayAddress}&margin=0`} alt="QR Code" style={{ width: '180px', height: '180px' }} />
        ) : (
            <QrCode size={180} color="black" />
        )}
        <p style={{ color: 'black', fontSize: '0.8rem', marginTop: '20px', wordBreak: 'break-all', textAlign: 'center', fontWeight: 'bold' }}>{displayAddress || 'Yükleniyor...'}</p>
        <p style={{ color: 'gray', fontSize: '0.75rem', margin: '5px 0 0 0' }}>memo gerekli değildir</p>
      </div>
      
      <div style={{ display: 'flex', justifyContent: 'center', gap: '20px', margin: '25px 0' }}>
         <div onClick={() => { navigator.clipboard.writeText(displayAddress); alert('Cüzdan adresiniz kopyalandı:\n' + displayAddress); }} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
            <div style={{ background: 'rgba(128,128,128,0.2)', padding: '15px', borderRadius: '16px' }}><ArrowRightLeft size={20} style={{ transform: 'rotate(90deg)' }} /></div>
            <span style={{ fontSize: '0.75rem', fontWeight: 'bold' }}>Kopyala</span>
         </div>
         <div onClick={() => { const amt = prompt('Ne kadar ' + networkName.split(' ')[0] + ' talep ediyorsunuz?'); if(amt) { alert('İstek tutarı eklendi, karekod güncellendi (Simülasyon).'); } }} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
            <div style={{ background: 'rgba(128,128,128,0.2)', padding: '15px', borderRadius: '16px' }}><Activity size={20} /></div>
            <span style={{ fontSize: '0.75rem', fontWeight: 'bold' }}>Tutarı Belirle</span>
         </div>
         <div onClick={() => { const txt = `QAI Cüzdan Adresim (${networkName}):\n${displayAddress}`; if(navigator.share){navigator.share({title:'Cüzdanım', text:txt}).catch(()=>{});}else{window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(txt)}`,'_blank');} }} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
            <div style={{ background: 'rgba(128,128,128,0.2)', padding: '15px', borderRadius: '16px' }}><Share2 size={20} /></div>
            <span style={{ fontSize: '0.75rem', fontWeight: 'bold' }}>Paylaş</span>
         </div>
      </div>
    </motion.div>
    );
  };

  const SendScreen = () => {
    let networkName = selectedToken ? (selectedToken.chain || 'Solana (SOL)') : 'Solana (SOL)';
    let symbol = selectedToken ? (networkName.includes('Ethereum') ? 'ETH' : networkName.split(' ')[0]) : 'SOL';
    if(networkName.includes('Tron') || networkName.includes('TRX')) symbol = 'TRX';
    if(networkName.includes('TON')) symbol = 'TON';
    if(networkName.includes('BSC')) symbol = 'BNB';
    if(networkName.includes('BTC') || networkName.includes('Bitcoin')) symbol = 'BTC';

    return (
    <motion.div key="send" initial={{ opacity: 0, y: 50 }} animate={{ opacity: 1, y: 0 }} className="glass-panel" style={{ maxWidth: '450px', width: '100%', padding: '20px', margin: 'auto', minHeight: '100vh', background: 'var(--bg-main)' }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: '25px', position: 'relative' }}>
        <div onClick={() => setWalletStage(selectedToken ? 'token_details' : 'dashboard')} style={{ cursor: 'pointer', color: 'var(--text-main)', padding: '5px', position: 'absolute', left: 0 }}>&larr;</div>
        <h2 style={{ fontSize: '1.2rem', fontWeight: 'bold', margin: '0 auto' }}>Gönder {symbol}</h2>
      </div>

      <div style={{ marginBottom: '20px' }}>
        <label style={{ fontSize: '0.85rem', color: 'var(--text-muted)', fontWeight: 'bold', display: 'block', marginBottom: '8px' }}>Adres veya Etki Alanı adı</label>
        <div style={{ display: 'flex', alignItems: 'center', background: 'rgba(128,128,128,0.1)', border: '1px solid #4cd964', borderRadius: '12px', padding: '12px 15px' }}>
           <input placeholder="Arayın veya Girin" style={{ background: 'transparent', border: 'none', color: 'white', flex: 1, outline: 'none', fontSize: '1rem' }} />
           <span style={{ color: '#4cd964', fontWeight: 'bold', fontSize: '0.9rem', marginRight: '15px', cursor: 'pointer' }}>Yapıştır</span>
           <span style={{ color: '#4cd964', marginRight: '10px', cursor: 'pointer' }}><Search size={20} /></span>
           <span style={{ color: '#4cd964', cursor: 'pointer' }}><QrCode size={20} /></span>
        </div>
      </div>

      <div style={{ marginBottom: '20px' }}>
        <label style={{ fontSize: '0.85rem', color: 'var(--text-muted)', fontWeight: 'bold', display: 'block', marginBottom: '8px' }}>Hedef Ağ (Destination network)</label>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', background: 'rgba(128,128,128,0.2)', padding: '8px 15px', borderRadius: '20px', cursor: 'pointer' }}>
           <span style={{ color: '#9945FF' }}>🟣</span> <span style={{ fontWeight: 'bold', fontSize: '0.9rem' }}>{networkName} ▼</span>
        </div>
      </div>

      <div style={{ marginBottom: '20px' }}>
        <label style={{ fontSize: '0.85rem', color: 'var(--text-muted)', fontWeight: 'bold', display: 'block', marginBottom: '8px' }}>Tutar</label>
        <div style={{ display: 'flex', alignItems: 'center', background: 'rgba(128,128,128,0.1)', border: '1px solid var(--glass-border)', borderRadius: '12px', padding: '12px 15px' }}>
           <input type="number" placeholder="0" style={{ background: 'transparent', border: 'none', color: 'white', flex: 1, outline: 'none', fontSize: '1.2rem' }} />
           <X size={16} color="var(--text-muted)" style={{ cursor: 'pointer', marginRight: '10px' }} />
           <span style={{ color: 'var(--text-muted)', fontWeight: 'bold', marginRight: '10px' }}>{symbol}</span>
           <span style={{ color: '#4cd964', fontWeight: 'bold', cursor: 'pointer' }}>Maksimum</span>
        </div>
        <p style={{ margin: '5px 0 0 0', fontSize: '0.8rem', color: 'var(--text-muted)' }}>≈ ₺0.00</p>
      </div>

      <div style={{ marginBottom: '30px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
           <label style={{ fontSize: '0.85rem', color: 'var(--text-muted)', fontWeight: 'bold' }}>Memo (İsteğe Bağlı)</label>
           <span onClick={() => setMemoOpen(!memoOpen)} style={{ fontSize: '0.75rem', color: '#4cd964', cursor: 'pointer' }}>{memoOpen ? 'Gizle' : 'Memo Ekle +'}</span>
        </div>
        {memoOpen && (
          <div style={{ display: 'flex', alignItems: 'center', background: 'rgba(128,128,128,0.1)', border: '1px solid var(--glass-border)', borderRadius: '12px', padding: '12px 15px' }}>
             <input placeholder="Memo Tag ID (Borsa gönderimleri için)" style={{ background: 'transparent', border: 'none', color: 'white', flex: 1, outline: 'none', fontSize: '1rem' }} />
             <span style={{ color: '#4cd964', cursor: 'pointer' }}><Info size={20} /></span>
          </div>
        )}
      </div>

      <div style={{ position: 'fixed', bottom: '20px', left: 0, right: 0, padding: '0 20px', maxWidth: '450px', margin: '0 auto' }}>
        <button style={{ width: '100%', background: 'rgba(76,217,100,0.5)', color: 'white', border: 'none', padding: '18px', borderRadius: '16px', fontSize: '1rem', fontWeight: 'bold', cursor: 'not-allowed' }}>
          İleri
        </button>
      </div>
    </motion.div>
    );
  };



  const WelcomeScreen = () => (
    <motion.div key="welcome" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, x: -50 }} className="glass-panel" style={{ maxWidth: '400px', width: '100%', padding: '30px', margin: 'auto', display: 'flex', flexDirection: 'column', gap: '20px', zIndex: 10 }}>
      
      {/* Dropdown for Language */}
      <div style={{ position: 'absolute', top: '15px', right: '15px' }}>
         <select value={lang} onChange={e => setLang(e.target.value)} style={{ background: 'rgba(128,128,128,0.2)', color: 'var(--text-main)', border: '1px solid var(--glass-border)', padding: '5px 10px', borderRadius: '10px', outline: 'none', cursor: 'pointer', fontSize: '0.8rem' }}>
            <option value="en">🇬🇧 English</option>
            <option value="tr">🇹🇷 Türkçe</option>
            <option value="zh">🇨🇳 中文</option>
            <option value="ru">🇷🇺 Русский</option>
            <option value="ar">🇸🇦 العربية</option>
            <option value="hi">🇮🇳 हिन्दी</option>
         </select>
      </div>

      <div style={{ textAlign: 'center', marginBottom: '10px', marginTop: '20px' }}>
        <img src="/logo.png" alt="QAI Logo" style={{ width: '150px', borderRadius: '20px', marginBottom: '15px' }} />
        <h2 style={{ fontSize: '1.25rem' }}>{t.welcomeTitle}</h2>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>{t.welcomeDesc}</p>
      </div>
      <button onClick={() => { setWalletAction('create'); setWalletStage('security'); }} style={{ background: 'var(--primary)', color: 'white', padding: '16px', borderRadius: '14px', border: 'none', fontSize: '1rem', fontWeight: 'bold', cursor: 'pointer' }}>{t.createWallet}</button>
      <button onClick={() => { setWalletAction('import'); setWalletStage('security'); }} style={{ background: 'transparent', color: 'var(--text-main)', padding: '16px', borderRadius: '14px', border: '2px solid var(--primary)', fontSize: '1rem', fontWeight: 'bold', cursor: 'pointer' }}>{t.importWallet}</button>
    </motion.div>
  );

  const SecurityScreen = () => (
    <motion.div key="security" initial={{ opacity: 0, x: 50 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -50 }} className="glass-panel" style={{ maxWidth: '400px', width: '100%', padding: '30px', margin: 'auto', display: 'flex', flexDirection: 'column', gap: '20px', zIndex: 10 }}>
       <div style={{ textAlign: 'center', marginBottom: '10px' }}>
        <ShieldCheck size={50} color="#4cd964" style={{ margin: '0 auto 15px auto' }} />
        <h2 style={{ fontSize: '1.25rem', color: 'var(--text-main)' }}>Ekstra Güvenlik</h2>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>Hesap kurtarma, bildirimler ve Web3 / Web4 eklentileri için tanımla.</p>
      </div>
      
      <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
        <div>
          <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{t.emailLabel}</label>
          <input type="email" value={userEmail} onChange={e => setUserEmail(e.target.value)} placeholder="ornek@email.com" style={{ width: '100%', padding: '15px', background: 'rgba(128,128,128,0.2)', border: '1px solid var(--glass-border)', borderRadius: '12px', color: 'var(--text-main)', outline: 'none', marginTop: '5px' }} />
        </div>
        <div>
          <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{t.mobileLabel}</label>
          <input type="tel" value={userMobile} onChange={e => setUserMobile(e.target.value)} placeholder="+90 5XX XXX XX XX" style={{ width: '100%', padding: '15px', background: 'rgba(128,128,128,0.2)', border: '1px solid var(--glass-border)', borderRadius: '12px', color: 'var(--text-main)', outline: 'none', marginTop: '5px' }} />
        </div>
      </div>
      
      <button onClick={() => {
        if (walletAction === 'create') setWalletStage('creating');
        else setWalletStage('importing');
      }} style={{ background: '#4cd964', color: 'black', padding: '16px', borderRadius: '14px', border: 'none', fontSize: '1rem', fontWeight: 'bold', cursor: 'pointer', marginTop: '10px' }}>{t.continueSec}</button>
      <div onClick={() => setWalletStage('welcome')} style={{ textAlign: 'center', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '0.8rem' }}>&larr; {t.back}</div>
    </motion.div>
  );

  const ImportWalletScreen = () => (
    <motion.div key="importing" initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} className="glass-panel" style={{ maxWidth: '450px', width: '100%', padding: '30px', margin: 'auto' }}>
       <div style={{ textAlign: 'center', color: '#ffb347' }}>
        <KeyRound size={40} style={{ margin: '0 auto 10px auto' }} />
        <h2 style={{ fontSize: '1.2rem', color: 'var(--text-main)' }}>{t.importWallet}</h2>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>{t.importSeedHint}</p>
      </div>
      <textarea 
        placeholder="12 kelimeyi boşluk bırakarak yapıştırın..."
        value={importInput}
        onChange={e => setImportInput(e.target.value)}
        style={{ width: '100%', height: '120px', padding: '15px', background: 'rgba(128,128,128,0.2)', border: '1px solid var(--glass-border)', borderRadius: '12px', color: 'var(--text-main)', outline: 'none', marginTop: '15px', resize: 'none' }}
      />
      <button onClick={() => {
        const words = importInput.trim().split(/\s+/);
        if (words.length >= 12) {
           try {
             const phrase = words.join(' ');
             const importedWallet = EthersWallet.fromPhrase(phrase);
             setSeedPhrase(words);
             setEvmAddress(importedWallet.address);
             localStorage.setItem('taste_wallet_seed', phrase);
             generateTonAddress(phrase);
             generateSolAddress(phrase);
             generateTronAddress(phrase);
             generateBtcAddress(phrase);
             setWalletStage('auth');
           } catch (e) {
             alert(lang === 'tr' ? 'Geçersiz 12 kelime şifresi!' : 'Invalid 12-word seed phrase!');
           }
        } else {
           alert(lang === 'tr' ? 'Lütfen en az 12 kelime girin!' : 'Please enter at least 12 words!');
        }
      }} style={{ background: 'var(--primary)', color: 'white', padding: '16px', borderRadius: '14px', border: 'none', width: '100%', fontWeight: 'bold', cursor: 'pointer', marginTop: '20px' }}>{t.importBtn}</button>
      <div onClick={() => setWalletStage('security')} style={{ textAlign: 'center', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '0.8rem', marginTop: '15px' }}>&larr; {t.back}</div>
    </motion.div>
  );

  const CreatingScreen = () => (
    <motion.div key="creating" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="glass-panel" style={{ maxWidth: '400px', width: '100%', padding: '40px', margin: 'auto', textAlign: 'center' }}>
      <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 2, ease: "linear" }}><Activity size={50} color="var(--primary)" style={{ margin: '0 auto' }} /></motion.div>
      <h3 style={{ marginTop: '20px' }}>{t.creating}</h3>
      <p style={{ color: 'var(--primary)' }}>{loadingText}</p>
    </motion.div>
  );

  const SeedScreen = () => (
    <motion.div key="seed" initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} className="glass-panel" style={{ maxWidth: '450px', width: '100%', padding: '30px', margin: 'auto' }}>
       <div style={{ textAlign: 'center', color: '#ffb347' }}>
        <AlertTriangle size={40} style={{ margin: '0 auto 10px auto' }} />
        <h2 style={{ fontSize: '1.2rem', color: 'var(--text-main)' }}>{t.seedTitle}</h2>
      </div>
       <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px', margin: '20px 0' }}>
        {seedPhrase.map((w, i) => (<div key={i} style={{ background: 'rgba(0,0,0,0.3)', padding: '10px', borderRadius: '8px', fontSize: '0.8rem' }}>{i+1}. {w}</div>))}
       </div>
       <button onClick={() => setWalletStage('auth')} style={{ background: 'var(--text-main)', color: 'var(--bg-main)', padding: '16px', borderRadius: '14px', border: 'none', width: '100%', fontWeight: 'bold', cursor: 'pointer' }}>{t.seedSave}</button>
    </motion.div>
  );

  // Icons for hiding balance
  const Eye = ({ size = 24, color = "currentColor" }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2.062 12.3c.338-1.579 1.488-4 5.313-5.2C10.536 6.13 13.565 6.42 16 8c2.972 1.93 4.298 5.093 4.819 6.643a1.458 1.458 0 0 1 0 1.054c-.521 1.55-1.847 4.713-4.819 6.643-2.435 1.58-5.464 1.87-8.625.9-3.825-1.2-4.975-3.621-5.313-5.2a1.442 1.442 0 0 1 0-1.04Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );

  const EyeOff = ({ size = 24, color = "currentColor" }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49" />
      <path d="M14.084 14.158a3 3 0 0 1-4.242-4.242" />
      <path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143" />
      <path d="m2 2 20 20" />
    </svg>
  );

  const DashboardScreen = () => (
    <motion.div key="dashboard" initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ maxWidth: '450px', width: '100%', padding: '20px', margin: '0 auto', paddingBottom: '110px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px', background: 'rgba(128,128,128,0.1)', borderRadius: '12px', marginBottom: '15px', fontSize: '0.7rem', color: 'var(--text-muted)', alignItems: 'center' }}>
        <div>Global Market Cap: <span style={{color: 'var(--text-main)'}}>$2.4T</span></div>
        <select value={fiatCurrency} onChange={(e) => setFiatCurrency(e.target.value)} style={{ background: 'transparent', color: 'var(--text-main)', border: 'none', outline: 'none', cursor: 'pointer', fontWeight: 'bold' }}>
           <option value="usd">USD ($)</option>
           <option value="eur">EUR (€)</option>
           <option value="try">TRY (₺)</option>
           <option value="gbp">GBP (£)</option>
           <option value="aed">AED (د.إ)</option>
           <option value="rub">RUB (₽)</option>
           <option value="cny">CNY (¥)</option>
           <option value="jpy">JPY (¥)</option>
        </select>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', position: 'relative', zIndex: 10 }}>
         <div onClick={() => {
            const themes = ['dark', 'taste-aura', 'cyber-neon', 'ocean-blue', 'royal-gold'];
            const idx = themes.indexOf(theme);
            setTheme(themes[(idx + 1) % themes.length]);
         }} style={{ cursor: 'pointer', padding: '5px', background: 'rgba(128,128,128,0.1)', borderRadius: '12px', border: '1px solid var(--glass-border)' }} title="Tasarım Değiştir">
            <Palette size={20} color="var(--text-muted)" />
         </div>
         
         <div 
            onClick={() => setNetworksExpanded(!networksExpanded)}
            style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', cursor: 'pointer', background: 'rgba(128,128,128,0.1)', padding: '10px 20px', borderRadius: '16px', border: '1px solid var(--glass-border)', minWidth: '220px' }}>
            
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
               <img src="/logo.png" alt="QAI Logo" style={{ width: '24px', height: '24px', borderRadius: '50%' }} />
               <span style={{ fontWeight: 'bold', fontSize: '1rem', color: 'var(--text-main)' }}>QAI Wallet</span>
               <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{networksExpanded ? '▲' : '▼'}</span>
            </div>
            
            <AnimatePresence>
               {networksExpanded && (
                 <motion.div 
                   initial={{ height: 0, opacity: 0 }} 
                   animate={{ height: 'auto', opacity: 1 }} 
                   exit={{ height: 0, opacity: 0 }}
                   style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '15px', overflow: 'hidden', width: '100%' }}
                 >
                    {evmAddress && <div title="EVM (ETH/BNB/Base/Monad)" style={{ fontSize: '0.75rem', color: '#4cd964', display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: '5px', borderBottom: '1px solid rgba(128,128,128,0.2)' }} onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(evmAddress); alert('EVM (Ethereum/BNB/Base) adresi kopyalandı: ' + evmAddress);}}><span>🟢 EVM</span> <span>{evmAddress.substring(0,6)}...{evmAddress.substring(evmAddress.length-4)} 📋</span></div>}
                    {evmAddress && <div title="Polygon (MATIC)" style={{ fontSize: '0.75rem', color: '#8247E5', display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: '5px', borderBottom: '1px solid rgba(128,128,128,0.2)' }} onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(evmAddress); alert('Polygon adresi kopyalandı: ' + evmAddress);}}><span>🟣 MATIC</span> <span>{evmAddress.substring(0,6)}...{evmAddress.substring(evmAddress.length-4)} 📋</span></div>}
                    {tonAddress && <div title="TON Network" style={{ fontSize: '0.75rem', color: '#0098EA', display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: '5px', borderBottom: '1px solid rgba(128,128,128,0.2)' }} onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(tonAddress); alert('TON adresi kopyalandı: ' + tonAddress);}}><span>🔵 TON</span> <span>{tonAddress.substring(0,6)}...{tonAddress.substring(tonAddress.length-4)} 📋</span></div>}
                    {solAddress && <div title="Solana" style={{ fontSize: '0.75rem', color: '#9945FF', display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: '5px', borderBottom: '1px solid rgba(128,128,128,0.2)' }} onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(solAddress); alert('Solana adresi kopyalandı: ' + solAddress);}}><span>🟣 SOL</span> <span>{solAddress.substring(0,6)}...{solAddress.substring(solAddress.length-4)} 📋</span></div>}
                    {tronAddress && <div title="TRON Network" style={{ fontSize: '0.75rem', color: '#FF060A', display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: '5px', borderBottom: '1px solid rgba(128,128,128,0.2)' }} onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(tronAddress); alert('TRON adresi kopyalandı: ' + tronAddress);}}><span>🔴 TRX</span> <span>{tronAddress.substring(0,6)}...{tronAddress.substring(tronAddress.length-4)} 📋</span></div>}
                    {btcAddress && <div title="Bitcoin (BTC)" style={{ fontSize: '0.75rem', color: '#F7931A', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }} onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(btcAddress); alert('Bitcoin adresi kopyalandı: ' + btcAddress);}}><span>🟠 BTC</span> <span>{btcAddress.substring(0,6)}...{btcAddress.substring(btcAddress.length-4)} 📋</span></div>}
                 </motion.div>
               )}
            </AnimatePresence>
         </div>
         
         {quantumShield ? (
            <div onClick={() => setQuantumShield(false)} style={{ display: 'flex', alignItems: 'center', gap: '5px', background: 'rgba(138, 43, 226, 0.2)', padding: '8px 12px', borderRadius: '20px', border: '1px solid #8A2BE2', cursor: 'pointer', marginTop: '10px' }}>
                <ShieldCheck size={16} color="#8A2BE2" /> <span style={{ fontSize: '0.75rem', color: '#8A2BE2', fontWeight: 'bold' }}>Quantum Kalkanı Aktif</span>
            </div>
         ) : (
            <div onClick={() => setQuantumShield(true)} style={{ display: 'flex', alignItems: 'center', gap: '5px', background: 'rgba(128,128,128,0.1)', padding: '8px 12px', borderRadius: '20px', cursor: 'pointer', marginTop: '10px' }}>
                <ShieldCheck size={16} color="var(--text-muted)" /> <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 'bold' }}>Quantum Guard</span>
            </div>
         )}
         
      </div>

      <div style={{ textAlign: 'center', padding: '35px 0', position: 'relative' }}>
        {balanceLoading && (
          <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1.5, ease: 'linear' }}
            style={{ position: 'absolute', top: '10px', right: '25px' }}>
            <RefreshCw size={16} color="var(--text-muted)" />
          </motion.div>
        )}
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '15px', marginBottom: '10px' }}>
          <h1 style={{ fontSize: '3rem', fontWeight: 'bold', letterSpacing: '-1.5px', margin: 0 }}>
            {hideBalance ? '****' : (totalPortfolio > 0 ? formatCurrency(totalPortfolio) : formatCurrency(0))}
          </h1>
          <div onClick={() => setHideBalance(!hideBalance)} style={{ cursor: 'pointer', color: 'var(--text-muted)' }}>
             {hideBalance ? <EyeOff size={24} /> : <Eye size={24} />}
          </div>
        </div>
        {!hideBalance && (
          <p style={{ color: totalPortfolio > 0 ? '#4cd964' : 'var(--text-muted)', fontWeight: 'bold', fontSize: '0.9rem', margin: 0 }}>
            {totalPortfolio > 0 ? `≈ ${formatCurrency(totalPortfolioUSD, 'usd')} USD` : (balanceLoading ? 'Bakiyeler yükleniyor...' : 'Cüzdan boş veya yüklenmedi')}
          </p>
        )}
        {lastUpdated && (
          <p style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: '4px' }}>
            🔄 {lastUpdated.toLocaleTimeString('tr-TR')} güncellendi
          </p>
        )}
        <div onClick={fetchAllBalances} style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', marginTop: '8px', cursor: 'pointer', color: '#4cd964', fontSize: '0.75rem', fontWeight: 'bold' }}>
          <RefreshCw size={12} /> Yenile
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'center', gap: '40px', marginBottom: '25px' }}>
        <div onClick={() => setWalletStage('receive')} style={{ textAlign: 'center', cursor: 'pointer' }}>
            <div style={{ background: 'rgba(128,128,128,0.1)', width: '55px', height: '55px', borderRadius: '50%', display: 'flex', justifyContent: 'center', alignItems: 'center' }}><Download size={22}/></div>
            <p style={{ fontSize: '0.75rem', marginTop: '8px', color: 'var(--text-muted)' }}>{t.deposit}</p>
        </div>
        <div onClick={() => setWalletStage('send')} style={{ textAlign: 'center', cursor: 'pointer' }}>
            <div style={{ background: 'rgba(128,128,128,0.1)', width: '55px', height: '55px', borderRadius: '50%', display: 'flex', justifyContent: 'center', alignItems: 'center' }}><Send size={22}/></div>
            <p style={{ fontSize: '0.75rem', marginTop: '8px', color: 'var(--text-muted)' }}>{t.send}</p>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '15px', overflowX: 'auto', borderBottom: '1px solid rgba(128,128,128,0.2)', marginBottom: '15px', paddingBottom: '5px', whiteSpace: 'nowrap' }}>
        <span 
            onClick={() => setDashboardTab('assets')}
            style={{ paddingBottom: '10px', fontSize: '0.85rem', cursor: 'pointer', fontWeight: 'bold', color: dashboardTab === 'assets' ? 'var(--text-main)' : 'var(--text-muted)', borderBottom: dashboardTab === 'assets' ? '2px solid #4cd964' : 'none' }}>
            {t.assets}
        </span>

        <span 
            onClick={() => setDashboardTab('networks')}
            style={{ paddingBottom: '10px', fontSize: '0.85rem', cursor: 'pointer', fontWeight: 'bold', color: dashboardTab === 'networks' ? 'var(--text-main)' : 'var(--text-muted)', borderBottom: dashboardTab === 'networks' ? '2px solid #4cd964' : 'none' }}>
            {t.networks}
        </span>
        <span 
            onClick={() => setDashboardTab('history')}
            style={{ paddingBottom: '10px', fontSize: '0.85rem', cursor: 'pointer', fontWeight: 'bold', color: dashboardTab === 'history' ? 'var(--text-main)' : 'var(--text-muted)', borderBottom: dashboardTab === 'history' ? '2px solid #4cd964' : 'none' }}>
            {lang === 'tr' ? 'Geçmiş' : 'History'}
        </span>
        <span 
            onClick={() => setDashboardTab('new_listings')}
            style={{ paddingBottom: '10px', fontSize: '0.85rem', cursor: 'pointer', fontWeight: 'bold', color: dashboardTab === 'new_listings' ? 'var(--text-main)' : 'var(--text-muted)', borderBottom: dashboardTab === 'new_listings' ? '2px solid #4cd964' : 'none' }}>
            {t.newListings}
        </span>
      </div>

      {dashboardTab === 'assets' && (
        <div style={{ paddingBottom: '0px' }}>
          {/* ─── Real Blockchain Assets ─── */}
          {[
            { name: 'Bitcoin', chain: 'BTC', color: '#F7931A', coinId: 'bitcoin', amount: balances.btc, symbol: 'BTC', logo: 'https://assets.coingecko.com/coins/images/1/standard/bitcoin.png', mc: '$1.4T', vol: '$42B', circ: '19.6M', socials: { web: 'bitcoin.org', twitter: '@Bitcoin' } },
            { name: 'Ethereum', chain: 'ETH', color: '#627EEA', coinId: 'ethereum', amount: balances.eth, symbol: 'ETH', logo: 'https://assets.coingecko.com/coins/images/279/standard/ethereum.png', mc: '$470B', vol: '$21B', circ: '120.1M', socials: { web: 'ethereum.org', twitter: '@ethereum' } },
            { name: 'BNB', chain: 'BSC', color: '#F3BA2F', coinId: 'binancecoin', amount: balances.bnb, symbol: 'BNB', logo: 'https://assets.coingecko.com/coins/images/825/standard/bnb-icon2_2x.png', mc: '$88B', vol: '$1.5B', circ: '149.5M', socials: { web: 'bnbchain.org', twitter: '@BNBCHAIN' } },
            { name: 'Solana', chain: 'SOL', color: '#9945FF', coinId: 'solana', amount: balances.sol, symbol: 'SOL', logo: 'https://assets.coingecko.com/coins/images/4128/standard/solana.png', mc: '$85B', vol: '$6.5B', circ: '445.8M', socials: { web: 'solana.com', twitter: '@solana' } },
            { name: 'Toncoin', chain: 'TON', color: '#0098EA', coinId: 'toncoin', amount: balances.ton, symbol: 'TON', logo: 'https://assets.coingecko.com/coins/images/17980/standard/ton_symbol.png', mc: '$18B', vol: '$400M', circ: '3.4B', socials: { web: 'ton.org', twitter: '@ton_blockchain' } },
            { name: 'Tron', chain: 'TRX', color: '#FF060A', coinId: 'tron', amount: balances.trx, symbol: 'TRX', logo: 'https://assets.coingecko.com/coins/images/1094/standard/tron-logo.png', mc: '$10B', vol: '$500M', circ: '87B', socials: { web: 'tron.network', twitter: '@trondao' } },
            { name: 'TASTE', chain: 'TON', value: '₺0.00', color: '#ffb347', change: '+0%', ca: 'EQB0beTxStmdhVri4s-cYlwYJaG_ZiR5lpLufCNC2VWUxZc-', amount: 0, symbol: 'TASTE', logo: '/logo.png', mc: '$1.2M', vol: '$45K', circ: '1,000,000,000', socials: { web: 'tastetoken.net', twitter: '@taste_token', tg: 'taste2025', bot: 'taste_launch_bot' } },
            { name: 'NION', chain: 'Solana', value: '₺0.00', color: '#14F195', change: '+0%', ca: '6f2qxhXjPLmz4kPhgz1WnyGNEzMSSGAtV4SGdUaDpump', amount: 0, symbol: 'NION', logo: '/logo.png', mc: '$850K', vol: '$12K', circ: '500,000,000', socials: { web: 'nion.ai', twitter: '@nion_sol' } },
            { name: 'USDT', chain: 'TRC20', value: '₺0.00', color: '#26A17B', change: '+0.01%', amount: 0, symbol: 'USDT', logo: 'https://assets.coingecko.com/coins/images/325/standard/Tether.png', mc: '$100B', vol: '$60B', circ: '100B' },
            { name: 'USDC', chain: 'ERC20', value: '₺0.00', color: '#2775CA', change: '-0.02%', amount: 0, symbol: 'USDC', logo: 'https://assets.coingecko.com/coins/images/6319/standard/usdc.png', mc: '$30B', vol: '$5B', circ: '30B' },
          ].map((tAsset, i) => {
            const tryVal = tAsset.coinId ? calcValue(tAsset.amount, tAsset.coinId) : 0;
            const usdVal = tAsset.coinId ? calcValue(tAsset.amount, tAsset.coinId, 'usd') : 0;
            const priceChange = prices[tAsset.coinId]?.usd_24h_change;
            const changeStr = priceChange ? `${priceChange >= 0 ? '+' : ''}${priceChange.toFixed(2)}%` : (tAsset.change || '0.00%');
            return (
              <div key={i} onClick={() => { setSelectedToken({...tAsset, value: formatCurrency(tryVal), change: changeStr, usdVal }); setWalletStage('token_details'); }} style={{ display: 'flex', justifyContent: 'space-between', padding: '15px 0', borderBottom: '1px solid rgba(128,128,128,0.2)', alignItems: 'center', cursor: 'pointer' }}>
                <div style={{ display: 'flex', gap: '15px', alignItems: 'center' }}>
                  <div style={{ width: '40px', height: '40px', borderRadius: '50%', background: tAsset.color, display: 'flex', justifyContent: 'center', alignItems: 'center', fontSize: '0.7rem', fontWeight: 'bold', color: 'white', overflow: 'hidden' }}>
                    {tAsset.logo ? <img src={tAsset.logo} alt={tAsset.symbol} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : tAsset.symbol?.substring(0,3)}
                  </div>
                  <div>
                    <p style={{ fontWeight: 'bold', fontSize: '1rem', margin: 0 }}>{tAsset.name}</p>
                    <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: '2px 0 0 0' }}>
                      {balances[tAsset.symbol.toLowerCase()] > 0 ? `${balances[tAsset.symbol.toLowerCase()].toFixed(2)} ${tAsset.symbol}` : tAsset.chain}
                      {tAsset.ca ? ' • Jetton' : ''}
                    </p>
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                   <p style={{ fontWeight: 'bold', fontSize: '1rem', margin: 0 }}>
                     {hideBalance ? '****' : (balanceLoading ? '...' : (tryVal > 0 ? formatCurrency(tryVal) : '0.00'))}
                   </p>
                   <p style={{ fontSize: '0.8rem', margin: '2px 0 0 0', color: changeStr.includes('+') ? '#4cd964' : (changeStr === '0.00%' || changeStr === '+0%' ? 'var(--text-muted)' : '#ff3b30') }}>
                     {changeStr}
                   </p>
                </div>
              </div>
            );
          })}
          {/* ERC20 tokens from Moralis */}
          {evmTokens.slice(0, 5).map((token, i) => {
            const amt = parseFloat(token.balance) / Math.pow(10, parseInt(token.decimals) || 18);
            return (
              <div key={`erc-${i}`} onClick={() => { setSelectedToken({ name: token.name, chain: 'ETH', color: '#627EEA', value: '₺0.00', change: '0.00%', amount: amt, symbol: token.symbol }); setWalletStage('token_details'); }} style={{ display: 'flex', justifyContent: 'space-between', padding: '15px 0', borderBottom: '1px solid rgba(128,128,128,0.2)', alignItems: 'center', cursor: 'pointer' }}>
                <div style={{ display: 'flex', gap: '15px', alignItems: 'center' }}>
                  <div style={{ width: '40px', height: '40px', borderRadius: '50%', background: 'rgba(98,126,234,0.3)', border: '1px solid #627EEA', display: 'flex', justifyContent: 'center', alignItems: 'center', fontSize: '0.65rem', fontWeight: 'bold', color: '#627EEA' }}>
                    {token.symbol?.substring(0,4)}
                  </div>
                  <div>
                    <p style={{ fontWeight: 'bold', fontSize: '1rem', margin: 0 }}>{token.name}</p>
                    <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: '2px 0 0 0' }}>{amt.toFixed(4)} {token.symbol} • ERC20</p>
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <p style={{ fontWeight: 'bold', fontSize: '1rem', margin: 0 }}>₺0.00</p>
                  <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: 0 }}>ETH Mainnet</p>
                </div>
              </div>
            );
          })}
          <div onClick={() => setWalletStage('import_token')} style={{ textAlign: 'center', color: '#4cd964', padding: '15px', background: 'rgba(76,217,100,0.1)', borderRadius: '12px', marginTop: '15px', cursor: 'pointer', fontWeight: 'bold' }}>
             <Plus size={18} style={{ display: 'inline-block', verticalAlign: 'middle', marginRight: '5px' }} />
             {t.importToken}
          </div>
        </div>
      )}

      {dashboardTab === 'networks' && (
        <div style={{ paddingBottom: '0px' }}>
          {[
            { name: 'Bitcoin', status: 'Bağlı', color: '#F7931A' },
            { name: 'Ethereum', status: 'Bağlı', color: '#627EEA' },
            { name: 'Solana', status: 'Bağlı', color: '#9945FF' },
            { name: 'BNB Smart Chain', status: 'Bağlı', color: '#F3BA2F' },
            { name: 'Base', status: 'Bağlı', color: '#0052FF' },
            { name: 'TON', status: 'Bağlı', color: '#0098EA' },
            { name: 'Monad', status: 'Bağlı', color: '#836EF9' },
            { name: 'Tron', status: 'Bağlı', color: '#FF060A' }
          ].map((n, i) => (
            <div key={i} onClick={() => { setSelectedToken({ name: n.name, chain: n.name, color: n.color, value: 'Active', change: '0.00%' }); setWalletStage('token_details'); }} style={{ display: 'flex', justifyContent: 'space-between', padding: '15px 0', borderBottom: '1px solid rgba(128,128,128,0.2)', alignItems: 'center', cursor: 'pointer' }}>
              <div style={{ display: 'flex', gap: '15px', alignItems: 'center' }}>
                <div style={{ width: '12px', height: '12px', borderRadius: '50%', background: n.color }}></div>
                <p style={{ fontWeight: 'bold' }}>{n.name}</p>
              </div>
              <div style={{ color: '#4cd964', fontSize: '0.8rem' }}>{n.status}</div>
            </div>
          ))}
        </div>
      )}

      {dashboardTab === 'new_listings' && (
        <div style={{ paddingBottom: '0px' }}>
             {/* Live Ticker Banner */}
             <div style={{ background: 'rgba(76,217,100,0.1)', border: '1px solid #4cd964', borderRadius: '16px', padding: '8px 15px', color: '#4cd964', fontSize: '0.75rem', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px', overflow: 'hidden', whiteSpace: 'nowrap', boxShadow: '0 0 10px rgba(76,217,100,0.2)' }}>
                <Activity size={18} style={{ flexShrink: 0 }} />
                <marquee scrollamount="5" style={{ display: 'inline-block' }}>🚀 UQDN... az önce 0.11 TON değerinde HOGWARTS aldı &nbsp;&nbsp;•&nbsp;&nbsp; 🔥 0x4F... 50 SOL değerinde PEPE AI sattı &nbsp;&nbsp;•&nbsp;&nbsp; 💎 TASTE Hacmi $4.2M'ye ulaştı! &nbsp;&nbsp;•&nbsp;&nbsp; 🚀 8xTR... The Boys token listeledi!</marquee>
             </div>
             
             {/* Spotlight Header & Launch Button */}
             <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
                <h3 style={{ margin: 0, fontSize: '1.2rem', display: 'flex', alignItems: 'center', gap: '8px' }}><Flame color="#ff4500" /> Spotlight</h3>
                <div onClick={() => setWalletStage('list_token')} style={{ background: 'rgba(76,217,100,0.15)', color: '#4cd964', padding: '6px 12px', borderRadius: '20px', fontSize: '0.8rem', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '5px', cursor: 'pointer', border: '1px solid #4cd964' }}>
                   <Rocket size={14} /> Launch token
                </div>
             </div>

             {/* VIP Spotlight Card */}
             <div onClick={() => { setSelectedToken({ name: 'HOGWARTS', chain: 'TON', color: '#0098EA', value: '$684.2K', change: '+254%' }); setWalletStage('token_details'); }} style={{ background: 'var(--bg-main)', borderRadius: '24px', overflow: 'hidden', border: '1px solid var(--primary)', marginBottom: '25px', position: 'relative', height: '220px', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', padding: '20px', cursor: 'pointer', boxShadow: '0 0 20px var(--primary-glow)' }}>
                 {/* 3D Grid Target / Background Effect */}
                 <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundImage: 'linear-gradient(rgba(255,255,255,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.05) 1px, transparent 1px)', backgroundSize: '30px 30px', transform: 'perspective(400px) rotateX(60deg) scale(2.5) translateY(-20px)', opacity: 0.6, zIndex: 1 }}></div>
                 
                 <div style={{ zIndex: 2, textAlign: 'center', marginBottom: '10px' }}>
                     <h2 style={{ fontSize: '2.5rem', fontWeight: 'bold', margin: '0 0 5px 0', textShadow: '0 0 10px rgba(255,255,255,0.2)', letterSpacing: '2px' }}>HOGWARTS</h2>
                     <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', margin: 0 }}>👥 341 <span style={{ margin: '0 10px' }}>↔</span> 12K Vol</p>
                 </div>
                 
                 <div style={{ zIndex: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
                     <h2 style={{ color: '#4cd964', margin: 0, fontSize: '2rem', fontWeight: 'bold', textShadow: '0 0 10px rgba(76,217,100,0.5)' }}>$684.2K</h2>
                     <div style={{ background: '#4cd964', color: 'black', borderRadius: '50%', padding: '10px' }}><Zap size={22} /></div>
                 </div>
             </div>

             {/* Filters */}
             <div style={{ display: 'flex', gap: '15px', color: 'var(--text-muted)', fontSize: '0.85rem', fontWeight: 'bold', marginBottom: '15px', borderBottom: '1px solid rgba(128,128,128,0.2)', paddingBottom: '10px' }}>
                <span style={{ color: 'var(--text-main)', borderBottom: '2px solid var(--text-main)', paddingBottom:'10px' }}>🔥 Hot</span>
                <span style={{ cursor: 'pointer' }}>⭐ Starred</span>
                <span style={{ cursor: 'pointer' }}>🟢 Live</span>
                <span style={{ cursor: 'pointer' }}>💰 My tokens</span>
             </div>

            {[
              { name: 'NUOMA52', holders: '1', txs: '17', mcap: '$571.1', age: '27h 15m', chain: 'TON', color: '#0098EA' },
              { name: 'GIFTS', holders: '7', txs: '11', mcap: '$638.9', age: '4d', chain: 'TON', color: '#0098EA' },
              { name: 'PEPE AI', holders: '4K', txs: '12K', mcap: '$1.2M', age: '12h', chain: 'Solana', color: '#10B981' },
              { name: 'T4U', holders: '2K', txs: '9K', mcap: '$23.1K', age: '1m ago', chain: 'Base', color: '#0052FF' },
              { name: 'PUTULAND', holders: '82', txs: '3K', mcap: '$427.0', age: '5h', chain: 'TON', color: '#0098EA' }
            ].map((token, idx) => (
              <div key={idx} onClick={() => { setSelectedToken({ name: token.name, chain: token.chain, color: token.color, value: token.mcap, change: '+10%' }); setWalletStage('token_details'); }} style={{ display: 'flex', justifyContent: 'space-between', padding: '15px 0', borderBottom: '1px solid rgba(128,128,128,0.2)', alignItems: 'center', cursor: 'pointer' }}>
                <div style={{ display: 'flex', gap: '15px', alignItems: 'center' }}>
                  <div style={{ width: '45px', height: '45px', borderRadius: '50%', background: 'rgba(128,128,128,0.1)', border: '1px solid var(--glass-border)', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
                     <Flame size={20} color={token.color} />
                  </div>
                  <div>
                     <p style={{ fontWeight: 'bold', fontSize: '1rem', margin: '0 0 4px 0' }}>{token.name}</p>
                     <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: 0 }}>👥 {token.holders} <span style={{ margin: '0 5px' }}>↔</span> {token.txs}</p>
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                   <p style={{ fontWeight: 'bold', fontSize: '1rem', color: '#4cd964', margin: '0 0 4px 0' }}>MC {token.mcap}</p>
                   <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: 0 }}>⏱ {token.age}</p>
                </div>
              </div>
            ))}
        </div>
      )}



      {dashboardTab === 'history' && (
        <div style={{ paddingBottom: '0px' }}>
           {[
             { type: 'Receive', asset: 'USDT (TRC20)', amount: '+500.00', usdAmount: '₺16,250.00', status: 'Completed', date: 'Bugün 14:30' },
             { type: 'Swap', asset: 'SOL -> USDC', amount: '15.0 SOL', usdAmount: '₺73,500.00', status: 'Completed', date: 'Dün 09:12' },
             { type: 'Send', asset: 'TON', amount: '-25.50', usdAmount: '₺4,850.25', status: 'Pending', date: '30 Mar 18:45' },
             { type: 'Buy', asset: 'BTC', amount: '+0.015', usdAmount: '₺48,200.00', status: 'Completed', date: '28 Mar 11:20' },
             { type: 'Mint', asset: 'Mad Lads NFT', amount: '-1.0 SOL', usdAmount: '₺4,800.00', status: 'Completed', date: '25 Mar 15:10' }
           ].map((tx, idx) => (
             <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', padding: '15px 0', borderBottom: '1px solid rgba(128,128,128,0.2)', alignItems: 'center' }}>
               <div style={{ display: 'flex', gap: '15px', alignItems: 'center' }}>
                 <div style={{ width: '40px', height: '40px', borderRadius: '50%', background: 'rgba(128,128,128,0.1)', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
                    {tx.type === 'Receive' || tx.type === 'Buy' ? <span style={{ color: '#4cd964' }}>↓</span> : (tx.type === 'Swap' ? <span style={{ color: '#ffb347' }}>↔</span> : <span style={{ color: '#ff3b30' }}>↑</span>)}
                 </div>
                 <div>
                    <p style={{ fontWeight: 'bold', fontSize: '0.9rem', color: 'var(--text-main)' }}>{tx.type} {tx.asset}</p>
                    <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{tx.date} • <span style={{ color: tx.status === 'Completed' ? '#4cd964' : '#ffb347' }}>{tx.status}</span></p>
                 </div>
               </div>
               <div style={{ textAlign: 'right' }}>
                  <p style={{ fontWeight: 'bold', fontSize: '0.9rem', color: (tx.type === 'Receive' || tx.type === 'Buy') ? '#4cd964' : (tx.type === 'Swap' ? 'var(--text-main)' : '#ff3b30') }}>{tx.amount}</p>
                  <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{tx.usdAmount}</p>
               </div>
             </div>
           ))}
        </div>
      )}
    </motion.div>
  );



  const ImportTokenScreen = () => (
    <motion.div key="import_token" className="glass-panel" style={{ maxWidth: '450px', width: '100%', padding: '20px', margin: 'auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '20px' }}>
        <div onClick={() => setWalletStage('dashboard')} style={{ cursor: 'pointer', color: 'var(--text-muted)' }}>&larr; {t.back}</div>
        <h2 style={{ fontSize: '1.2rem', fontWeight: 'bold', color: 'var(--text-main)' }}>Kripto İçe Aktar</h2>
        <Info size={18} color="var(--text-main)" />
      </div>

      <div style={{ background: 'rgba(128,128,128,0.1)', padding: '15px', borderRadius: '12px', marginBottom: '15px', fontSize: '0.75rem', color: 'var(--text-muted)', border: '1px solid var(--glass-border)' }}>
        Web4 Smart Explorer Engine devrede. Girdiğiniz adres (CA) anlık olarak <strong>Solscan, Etherscan, Tonviewer, BscScan</strong> ve <strong>Tronscan</strong> veritabanlarında çapraz taranır. Explorer yanıt vermezse ağ türünü manuel seçebilirsiniz.
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
        <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Mevcut Ağlardaki Kontrat Adresi (CA)</label>
        <div style={{ position: 'relative' }}>
          <input placeholder="0x... veya EQ..." style={{ width: '100%', padding: '15px', background: 'rgba(128,128,128,0.2)', border: '1px solid var(--glass-border)', borderRadius: '12px', color: 'var(--text-main)', outline: 'none' }} />
          <QrCode size={20} style={{ position: 'absolute', right: '15px', top: '15px', color: 'var(--text-muted)', cursor: 'pointer' }} />
        </div>
        
        <div style={{ marginTop: '5px' }}>
            <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Manuel Explorer / Ağ Seçimi</label>
            <select style={{ width: '100%', padding: '12px', background: 'var(--bg-card)', color: 'var(--text-main)', outline: 'none', border: '1px solid var(--glass-border)', borderRadius: '10px', marginTop: '8px' }}>
                <option value="auto">Multi-Explorer Otomatik Tarama</option>
                <option value="ton">TON Network (Tonviewer)</option>
                <option value="sol">Solana (Solscan)</option>
                <option value="eth">Ethereum (Etherscan)</option>
                <option value="bsc">BNB Smart Chain (BscScan)</option>
                <option value="trx">Tron (Tronscan)</option>
                <option value="base">Base (Basescan)</option>
                <option value="monad">Monad Explorer</option>
            </select>
        </div>
      </div>
      <button style={{ background: '#4cd964', color: 'black', padding: '18px', borderRadius: '14px', border: 'none', width: '100%', fontWeight: 'bold', marginTop: '20px', cursor: 'pointer' }} onClick={() => setWalletStage('dashboard')}>Varlığı İçe Aktar (Explore)</button>
    </motion.div>
  );

  const ListTokenScreen = () => (
    <motion.div key="list_token" style={{ maxWidth: '450px', width: '100%', padding: '20px', margin: '0 auto', paddingBottom: '90px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '20px', alignItems: 'center' }}>
        <div onClick={() => setWalletStage('discover')} style={{ cursor: 'pointer', color: 'var(--text-muted)' }}>&larr; {t.cancel}</div>
        <h2 style={{ fontSize: '1.2rem', fontWeight: 'bold', color: 'var(--text-main)' }}>{lang === 'tr' ? 'Token Reklamı & Listeleme' : 'Token Ads & Listing'}</h2>
        <Flame size={20} color="var(--primary)" />
      </div>

      <div style={{ background: 'rgba(128,128,128,0.1)', padding: '15px', borderRadius: '12px', marginBottom: '15px', fontSize: '0.75rem', color: 'var(--text-muted)', border: '1px solid var(--glass-border)' }}>
        {lang === 'tr' 
          ? "Projenizi Pump.fun, Pinksale veya kendi ağınızdan bağımsız olarak anında on binlerce aktif cüzdan sahibine ulaştırın. 'Trending' sayfasının en tepesinde 48 saat VIP görünürlük satın alın." 
          : "Promote your project independent of Pump.fun or Pinksale. Reach tens of thousands of active wallets instantly by purchasing a 48h VIP spot at the top of the Trending page."}
      </div>
      
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <input placeholder={lang === 'tr' ? "Token Adı (Örn: DOGE AI)" : "Token Name (e.g. DOGE AI)"} style={{ padding: '12px', background: 'rgba(128,128,128,0.2)', border: '1px solid var(--glass-border)', borderRadius: '10px', color: 'var(--text-main)', outline: 'none' }} />
        <input placeholder={lang === 'tr' ? "Kontrat Adresi (CA)" : "Contract Address (CA)"} style={{ padding: '12px', background: 'rgba(128,128,128,0.2)', border: '1px solid var(--glass-border)', borderRadius: '10px', color: 'var(--text-main)', outline: 'none' }} />
        
        <p style={{ fontSize: '0.8rem', color: 'var(--primary)', marginTop: '5px', fontWeight: 'bold' }}>{lang === 'tr' ? 'Sosyal Ağlar & Proje Detayları' : 'Social Networks & Project Links'}</p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
            <input placeholder="Website" style={{ padding: '10px', background: 'rgba(128,128,128,0.1)', border: '1px solid var(--glass-border)', borderRadius: '8px', color: 'var(--text-main)', fontSize: '0.8rem', outline: 'none' }} />
            <input placeholder="Telegram (t.me/...)" style={{ padding: '10px', background: 'rgba(128,128,128,0.1)', border: '1px solid var(--glass-border)', borderRadius: '8px', color: 'var(--text-main)', fontSize: '0.8rem', outline: 'none' }} />
            <input placeholder="Twitter (X)" style={{ padding: '10px', background: 'rgba(128,128,128,0.1)', border: '1px solid var(--glass-border)', borderRadius: '8px', color: 'var(--text-main)', fontSize: '0.8rem', outline: 'none' }} />
            <input placeholder="Discord" style={{ padding: '10px', background: 'rgba(128,128,128,0.1)', border: '1px solid var(--glass-border)', borderRadius: '8px', color: 'var(--text-main)', fontSize: '0.8rem', outline: 'none' }} />
        </div>

        <p style={{ fontSize: '0.85rem', color: 'var(--primary)', marginTop: '10px', fontWeight: 'bold' }}>{lang === 'tr' ? 'Listeleme Paketi Seçimi' : 'Select Listing Package'}</p>
        <div style={{ display: 'flex', gap: '10px' }}>
           <div style={{ flex: 1, padding: '15px', background: 'var(--bg-card)', border: '1px solid var(--glass-border)', borderRadius: '12px', textAlign: 'center', cursor: 'pointer' }}>
             <h3 style={{ margin: 0, fontSize: '0.9rem', color: 'var(--text-main)' }}>{lang === 'tr' ? 'Normal Liste' : 'Standard List'}</h3>
             <p style={{ margin: '5px 0 0 0', fontSize: '0.8rem', color: '#4cd964', fontWeight: 'bold' }}>25 USDT</p>
           </div>
           <div style={{ flex: 1, padding: '15px', background: 'rgba(255,179,71,0.1)', border: '1px solid var(--primary)', borderRadius: '12px', textAlign: 'center', cursor: 'pointer' }}>
             <div style={{ fontSize: '0.6rem', background: 'var(--primary)', color: 'black', padding: '2px', borderRadius: '4px', display: 'inline-block', marginBottom: '5px', fontWeight: 'bold' }}>VIP PROMO</div>
             <h3 style={{ margin: 0, fontSize: '0.9rem', color: 'var(--text-main)' }}>{lang === 'tr' ? 'Reklamlı (48s)' : 'Promoted (48h)'}</h3>
             <p style={{ margin: '5px 0 0 0', fontSize: '0.8rem', color: '#4cd964', fontWeight: 'bold' }}>45 USDT</p>
           </div>
        </div>

        <div style={{ marginTop: '5px' }}>
            <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{lang === 'tr' ? 'Ödeme Yapılacak Ağ' : 'Payment Network'}</label>
            <select style={{ width: '100%', padding: '12px', background: 'var(--bg-card)', color: 'var(--text-main)', outline: 'none', border: '1px solid var(--glass-border)', borderRadius: '10px', marginTop: '8px' }}>
                <option value="sol">Solana (SOL / SPL)</option>
                <option value="eth">Ethereum (ETH / ERC20)</option>
                <option value="btc">Bitcoin (BTC)</option>
                <option value="tron">Tron (TRX / TRC20)</option>
                <option value="ton">TON Network</option>
                <option value="bsc">BNB Smart Chain (BEP20)</option>
            </select>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '10px' }}>
          <div onClick={() => setPayWithTaste(payWithTaste === 'taste' ? false : 'taste')} style={{ background: payWithTaste === 'taste' ? 'rgba(76,217,100,0.15)' : 'rgba(128,128,128,0.1)', padding: '15px', borderRadius: '12px', border: payWithTaste === 'taste' ? '1px solid #4cd964' : '1px solid var(--glass-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}>
              <div>
                <h4 style={{ color: 'var(--text-main)', margin: 0, fontSize: '0.9rem' }}>{lang === 'tr' ? 'TASTE ile Öde' : 'Pay with TASTE'}</h4>
                <p style={{ fontSize: '0.7rem', opacity: 0.8, color: payWithTaste === 'taste' ? '#4cd964' : 'var(--text-muted)', marginTop: '2px' }}>{lang === 'tr' ? '%30 Net İndirim!' : '30% Flat Discount!'}</p>
              </div>
              <CheckCircle2 size={20} color={payWithTaste === 'taste' ? '#4cd964' : 'gray'} />
          </div>
          <div onClick={() => setPayWithTaste(payWithTaste === 'nion' ? false : 'nion')} style={{ background: payWithTaste === 'nion' ? 'rgba(20,241,149,0.15)' : 'rgba(128,128,128,0.1)', padding: '15px', borderRadius: '12px', border: payWithTaste === 'nion' ? '1px solid #14F195' : '1px solid var(--glass-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}>
              <div>
                <h4 style={{ color: 'var(--text-main)', margin: 0, fontSize: '0.9rem' }}>{lang === 'tr' ? 'NION ile Öde' : 'Pay with NION'}</h4>
                <p style={{ fontSize: '0.7rem', opacity: 0.8, color: payWithTaste === 'nion' ? '#14F195' : 'var(--text-muted)', marginTop: '2px' }}>{lang === 'tr' ? '%25 Net İndirim!' : '25% Flat Discount!'}</p>
              </div>
              <CheckCircle2 size={20} color={payWithTaste === 'nion' ? '#14F195' : 'gray'} />
          </div>
        </div>

        <div style={{ background: 'rgba(128,128,128,0.1)', padding: '12px', borderRadius: '12px', border: '1px dashed var(--glass-border)', marginTop: '5px', display: 'flex', gap: '10px', alignItems: 'center' }}>
            <Info size={28} color="var(--primary)" style={{ flexShrink: 0 }} />
            <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', margin: 0 }}>
               {lang === 'tr' ? 'Not: Onaylanan tokenlar Ana Sayfa "Yeni Listelenenler" ve "Trendler" sıralamasında ödeme modeline göre anında canlıya alınır.' : 'Note: Approved tokens immediately go live on the global "New Listings" and "Trending" sections based on their tier.'}
            </p>
        </div>

        <button style={{ background: 'var(--primary)', color: 'white', padding: '18px', borderRadius: '14px', border: 'none', fontWeight: 'bold', marginTop: '10px', cursor: 'pointer', fontSize: '1rem', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '8px' }} onClick={() => setWalletStage('dashboard')}>
          <Sparkles size={18} /> {lang === 'tr' ? 'Reklam Kampanyasını Başlat' : 'Start Ad Campaign'}
        </button>
      </div>
    </motion.div>
  );

  const TokenDetailsScreen = () => {
    if(!selectedToken) return <div/>;
    
    let displayAddress = evmAddress;
    if (selectedToken.ca && !selectedToken.chain?.includes('TRC20')) {
        displayAddress = selectedToken.ca;
    } else {
        const chain = selectedToken.chain || '';
        const name = selectedToken.name || '';
        
        if(chain.includes('Solana') || name === 'Solana' || chain === 'SOL') displayAddress = solAddress;
        else if(chain.includes('TON') || name === 'Toncoin' || chain === 'TON') displayAddress = tonAddress;
        else if(chain.includes('Tron') || chain.includes('TRX') || chain.includes('TRC20') || name === 'Tron') displayAddress = tronAddress;
        else if(chain.includes('BTC') || name === 'Bitcoin' || chain === 'Bitcoin') displayAddress = btcAddress;
        else if(chain.includes('Base') || chain.includes('Monad') || chain.includes('BSC') || chain.includes('ETH')) displayAddress = evmAddress;
    }

    const coinPrice = selectedToken.coinId ? prices[selectedToken.coinId] : null;
    const usdPrice = coinPrice?.usd || 0;
    const tryPrice = coinPrice?.try || 0;
    const change24h = coinPrice?.usd_24h_change;
    const changeStr = change24h != null
      ? `${change24h >= 0 ? '+' : ''}${change24h.toFixed(2)}%`
      : (selectedToken.change || '0.00%');
    const isPositive = changeStr.includes('+');
    const chartColor = isPositive ? '#4cd964' : '#ff3b30';
    const tokenAmount = balances[selectedToken.symbol.toLowerCase()] || 0;
    const portfolioTRY = tokenAmount * tryPrice;
    
    // Build SVG chart path from real data or animated fallback
    const buildChartPath = () => {
      if (chartData && chartData.length > 1) {
        const pts = chartData;
        const vals = pts.map(p => p[1]);
        const minV = Math.min(...vals), maxV = Math.max(...vals);
        const range = maxV - minV || 1;
        const W = 400, H = 120;
        const coords = pts.map((p, i) => {
          const x = (i / (pts.length - 1)) * W;
          const y = H - ((p[1] - minV) / range) * H;
          return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
        }).join(' ');
        return coords;
      }
      // Animated fallback based on change direction
      return isPositive
        ? 'M 0 100 C 50 90, 80 70, 120 60 S 180 30, 220 40 S 300 15, 350 10 L 400 5'
        : 'M 0 20 C 50 30, 80 50, 120 65 S 180 85, 220 80 S 300 100, 350 105 L 400 110';
    };
    const svgPath = buildChartPath();

    return (
    <motion.div key="token_details"
      initial={{ opacity: 0, x: 40 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -40 }} transition={{ duration: 0.22 }}
      style={{ maxWidth: '450px', width: '100%', margin: '0 auto', minHeight: '100vh', background: 'var(--bg-main)', display: 'flex', flexDirection: 'column' }}>

      {/* Sticky Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 20px', position: 'sticky', top: 0, background: 'var(--bg-main)', zIndex: 50, borderBottom: '1px solid rgba(128,128,128,0.12)' }}>
        <div onClick={() => { setWalletStage('dashboard'); setSelectedToken(null); }}
          style={{ cursor: 'pointer', padding: '8px 14px', background: 'rgba(128,128,128,0.15)', borderRadius: '10px', display: 'flex', alignItems: 'center', gap: '5px', color: 'var(--text-main)', fontSize: '0.9rem', fontWeight: 'bold' }}>← Geri</div>
        <div style={{ textAlign: 'center' }}>
          <p style={{ margin: 0, fontSize: '1rem', fontWeight: 'bold', color: 'var(--text-main)' }}>{selectedToken.name}</p>
          <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{selectedToken.chain} Ağı</span>
        </div>
        <div style={{ color: '#4cd964', cursor: 'pointer', fontSize: '1.4rem' }}>★</div>
      </div>

      {/* Scrollable body */}
      <div style={{ flex: 1, overflowY: 'auto', paddingBottom: '90px' }}>

      {/* Address bar */}
      <div style={{ background: 'rgba(128,128,128,0.05)', borderRadius: '16px', margin: '15px 20px', padding: '12px 15px', display: 'flex', alignItems: 'center', gap: '12px', border: '1px solid var(--glass-border)' }}>
         <div onClick={() => setWalletStage('receive')} style={{ background: 'rgba(76,217,100,0.1)', padding: '8px', borderRadius: '8px', cursor: 'pointer' }}>
            <QrCode size={24} color="#4cd964" />
         </div>
         <div style={{ flex: 1, overflow: 'hidden' }}>
            <p style={{ margin: 0, fontSize: '0.65rem', color: 'var(--text-muted)' }}>Cüzdan Adresi</p>
            <p style={{ margin: '2px 0 0 0', fontSize: '0.75rem', fontWeight: 'bold', color: 'var(--primary)', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>{displayAddress || 'Yükleniyor...'}</p>
         </div>
         <div onClick={() => { navigator.clipboard.writeText(displayAddress); alert('Cüzdan adresiniz kopyalandı:\n' + displayAddress); }} style={{ background: 'rgba(76,217,100,0.1)', padding: '6px 10px', borderRadius: '8px', cursor: 'pointer', flexShrink: 0 }}>
            <span style={{ fontSize: '0.7rem', color: '#4cd964', fontWeight: 'bold' }}>📋 Kopyala</span>
         </div>
      </div>
      
      <div style={{ textAlign: 'center', padding: '15px 20px 0 20px' }}>
         <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px', marginBottom: '5px' }}>
           <div style={{ width: '36px', height: '36px', borderRadius: '50%', background: selectedToken.color || '#627EEA', display: 'flex', justifyContent: 'center', alignItems: 'center', fontSize: '0.65rem', fontWeight: 'bold', color: 'white', overflow: 'hidden' }}>
             {selectedToken.logo ? <img src={selectedToken.logo} alt={selectedToken.symbol} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : (selectedToken.symbol?.substring(0,3) || selectedToken.chain?.substring(0,3))}
           </div>
           <h1 style={{ fontSize: '2.5rem', margin: 0, fontWeight: 'bold' }}>
             {tryPrice > 0 ? `₺${(tokenAmount * tryPrice).toLocaleString('tr-TR', {maximumFractionDigits: 2})}` : (selectedToken.symbol === 'TASTE' ? formatCurrency(tokenAmount * 0.05) : '₺0.00')}
           </h1>
           <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginTop: '5px' }}>{tokenAmount.toFixed(4)} {selectedToken.symbol}</p>
         </div>
         <p style={{ color: isPositive ? '#4cd964' : '#ff3b30', margin: '0 0 4px 0', fontSize: '0.9rem', fontWeight: 'bold' }}>
           {isPositive ? '▲' : '▼'} {changeStr} (24 Saat)
         </p>
         {usdPrice > 0 && (
           <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: 0 }}>
             ≈ ${usdPrice.toLocaleString('en-US', {maximumFractionDigits: 6})} USD
           </p>
         )}
      </div>

      {/* Chart */}
      <div style={{ height: '190px', width: '100%', marginTop: '10px', padding: '0 5px' }}>
        {!chartData && selectedToken?.coinId && (
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
            <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1.5, ease: 'linear' }} style={{ marginRight: '8px' }}><RefreshCw size={14} /></motion.div>
            Grafik yükleniyor...
          </div>
        )}
        {(chartData || !selectedToken?.coinId) && (
         <svg viewBox="0 0 400 120" style={{ width: '100%', height: '100%', overflow: 'visible' }}>
           <defs>
             <linearGradient id="chartGrad" x1="0" y1="0" x2="0" y2="1">
               <stop offset="0%" stopColor={chartColor} stopOpacity="0.4"/>
               <stop offset="100%" stopColor={chartColor} stopOpacity="0"/>
             </linearGradient>
           </defs>
           <motion.path
             initial={{ pathLength: 0, opacity: 0 }}
             animate={{ pathLength: 1, opacity: 1 }}
             transition={{ duration: 1.2, ease: 'easeOut' }}
             d={svgPath}
             fill="none"
             stroke={chartColor}
             strokeWidth="2.5"
             strokeLinecap="round"
           />
           <path d={`${svgPath} L 400 120 L 0 120 Z`} fill="url(#chartGrad)" opacity="0.5" />
         </svg>
        )}
      </div>
      
      {/* Time filters */}
      <div style={{ display: 'flex', justifyContent: 'space-around', padding: '8px 20px', color: 'var(--text-muted)', fontSize: '0.85rem', fontWeight: 'bold' }}>
         {['LIVE','1m','1H','1D','1W','1M'].map((tf, i) => (
           <span key={tf} style={{ cursor:'pointer', color: i === 2 ? 'var(--text-main)' : 'var(--text-muted)', background: i === 2 ? 'rgba(255,255,255,0.1)' : 'transparent', padding: '4px 8px', borderRadius: '8px' }}>{tf}</span>
         ))}
      </div>

      <div style={{ padding: '0 20px', marginTop: '10px' }}>
         <div style={{ background: 'var(--bg-card)', borderRadius: '16px', padding: '20px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', border: '1px solid var(--glass-border)', marginBottom: '30px' }}>
           <div><p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', margin: '0 0 5px 0' }}>{t.marketCap}</p><p style={{ fontWeight: 'bold', margin: 0 }}>{selectedToken.mc || '$78.4B'}</p></div>
           <div><p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', margin: '0 0 5px 0' }}>{t.vol24h}</p><p style={{ fontWeight: 'bold', margin: 0 }}>{selectedToken.vol || '$2.1B'}</p></div>
           <div><p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', margin: '0 0 5px 0' }}>{t.circSupply}</p><p style={{ fontWeight: 'bold', margin: 0 }}>{selectedToken.circ || '142.5M'}</p></div>
           <div><p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', margin: '0 0 5px 0' }}>Risk</p><p style={{ fontWeight: 'bold', margin: 0, color: '#4cd964' }}>No Risk</p></div>
        </div>

        {selectedToken.socials && (
           <div style={{ marginBottom: '30px' }}>
             <h4 style={{ color: 'var(--text-main)', marginBottom: '10px' }}>Proje ve Sosyal Ağlar (Veritabanı)</h4>
             <div style={{ display: 'flex', gap: '15px', flexWrap: 'wrap' }}>
               {selectedToken.socials.web && <div onClick={() => window.open(`https://${selectedToken.socials.web}`, '_blank')} style={{ background: 'rgba(128,128,128,0.1)', padding: '10px 15px', borderRadius: '10px', fontSize: '0.8rem', cursor: 'pointer', border: '1px solid var(--glass-border)' }}>🌐 Website</div>}
               {selectedToken.socials.twitter && <div onClick={() => window.open(`https://twitter.com/${selectedToken.socials.twitter.replace('@','')}`, '_blank')} style={{ background: 'rgba(128,128,128,0.1)', padding: '10px 15px', borderRadius: '10px', fontSize: '0.8rem', cursor: 'pointer', border: '1px solid var(--glass-border)' }}>🐦 {selectedToken.socials.twitter}</div>}
               {selectedToken.socials.tg && <div onClick={() => window.open(`https://${selectedToken.socials.tg}`, '_blank')} style={{ background: 'rgba(128,128,128,0.1)', padding: '10px 15px', borderRadius: '10px', fontSize: '0.8rem', cursor: 'pointer', border: '1px solid var(--glass-border)' }}>✈️ Telegram Grubu</div>}
               {selectedToken.socials.bot && <div onClick={() => window.open(`https://t.me/${selectedToken.socials.bot}`, '_blank')} style={{ background: 'rgba(255, 0, 122, 0.1)', padding: '10px 15px', borderRadius: '10px', fontSize: '0.8rem', cursor: 'pointer', border: '1px solid #FF007A', color: '#FF007A', fontWeight: 'bold' }}>🤖 Mini App (Bot)</div>}
               {selectedToken.chain?.includes('Sol') && <div onClick={() => window.open(`https://solscan.io/token/${selectedToken.ca || displayAddress}`, '_blank')} style={{ background: 'rgba(128,128,128,0.1)', padding: '10px 15px', borderRadius: '10px', fontSize: '0.8rem', cursor: 'pointer', border: '1px solid var(--glass-border)', color: '#9945FF' }}>🔍 Solscan</div>}
               {selectedToken.chain?.includes('ETH') && <div onClick={() => window.open(`https://etherscan.io/address/${selectedToken.ca || displayAddress}`, '_blank')} style={{ background: 'rgba(128,128,128,0.1)', padding: '10px 15px', borderRadius: '10px', fontSize: '0.8rem', cursor: 'pointer', border: '1px solid var(--glass-border)', color: '#627EEA' }}>🔍 Etherscan</div>}
               {selectedToken.chain?.includes('TON') && <div onClick={() => window.open(`https://tonviewer.com/${selectedToken.ca || displayAddress}`, '_blank')} style={{ background: 'rgba(128,128,128,0.1)', padding: '10px 15px', borderRadius: '10px', fontSize: '0.8rem', cursor: 'pointer', border: '1px solid var(--glass-border)', color: '#0098EA' }}>🔍 Tonviewer</div>}
             </div>
           </div>
        )}

        <div style={{ marginBottom: '30px' }}>
          <h4 style={{ color: 'var(--text-main)', marginBottom: '15px' }}>İşlem Geçmişi ({selectedToken.symbol})</h4>
          {['Gelen', 'Giden'].map((type, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '15px 0', borderBottom: '1px solid rgba(128,128,128,0.2)', alignItems: 'center' }}>
              <div style={{ display: 'flex', gap: '15px', alignItems: 'center' }}>
                <div style={{ width: '35px', height: '35px', borderRadius: '50%', background: 'rgba(128,128,128,0.1)', display: 'flex', justifyContent: 'center', alignItems: 'center', color: type === 'Gelen' ? '#4cd964' : 'var(--text-main)' }}>
                  {type === 'Gelen' ? '↓' : '↑'}
                </div>
                <div>
                   <p style={{ fontWeight: 'bold', fontSize: '0.9rem', color: 'var(--text-main)', margin: 0 }}>{type} Transfer</p>
                   <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', margin: 0 }}>Bugün 14:30 • <span style={{ color: '#4cd964' }}>Completed</span></p>
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <p style={{ fontWeight: 'bold', fontSize: '0.9rem', color: type === 'Gelen' ? '#4cd964' : 'var(--text-main)', margin: 0 }}>{type === 'Gelen' ? '+' : '-'}{(Math.random() * 5).toFixed(2)} {selectedToken.symbol}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
      
      <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, width: '100%', maxWidth: '450px', background: 'var(--bg-card)', borderTop: '1px solid var(--glass-border)', display: 'flex', justifyContent: 'space-around', alignItems: 'center', padding: '15px 10px', margin: '0 auto', zIndex: 120 }}>
          <div onClick={() => setWalletStage('send')} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '5px', cursor: 'pointer', color: 'var(--text-main)' }}>
             <div style={{ background: 'rgba(255,255,255,0.05)', padding: '12px', borderRadius: '12px' }}><ArrowRightLeft size={20} style={{ transform: 'rotate(-45deg)' }} /></div>
             <span style={{ fontSize: '0.7rem' }}>{t.sendTitle}</span>
          </div>
          <div onClick={() => setWalletStage('receive')} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '5px', cursor: 'pointer', color: 'var(--text-main)' }}>
             <div style={{ background: 'rgba(255,255,255,0.05)', padding: '12px', borderRadius: '12px' }}><ArrowRightLeft size={20} style={{ transform: 'rotate(135deg)' }} /></div>
             <span style={{ fontSize: '0.7rem' }}>{t.receiveTitle}</span>
          </div>
          <div onClick={() => setWalletStage('swap')} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '5px', cursor: 'pointer', color: 'black' }}>
             <div style={{ background: '#4cd964', padding: '12px', borderRadius: '12px' }}><Repeat size={20} /></div>
             <span style={{ fontSize: '0.7rem', color: 'var(--text-main)' }}>{t.swapTitle}</span>
          </div>
          <div onClick={() => setWalletStage('earn')} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '5px', cursor: 'pointer', color: 'var(--text-main)' }}>
             <div style={{ background: 'rgba(255,255,255,0.05)', padding: '12px', borderRadius: '12px' }}><Gift size={20} /></div>
             <span style={{ fontSize: '0.7rem' }}>{t.earnTitle}</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '5px', cursor: 'pointer', color: 'var(--text-main)' }}>
             <div style={{ background: 'rgba(255,255,255,0.05)', padding: '12px', borderRadius: '12px' }}>...</div>
             <span style={{ fontSize: '0.7rem' }}>{t.moreTitle}</span>
          </div>
      </div>
    </motion.div>
  );
};


  return (
    <div style={{ width: '100vw', minHeight: '100vh', display: 'flex', flexDirection: 'column', position: 'relative', overflowX: 'hidden', background: 'var(--bg-main)' }}>
      {['dashboard', 'trending', 'earn', 'discover'].includes(walletStage) && <TopSettingsBar />}
      <div style={{ width: '100%', flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: '10px' }}>
        <AnimatePresence mode="wait">
          {walletStage === 'welcome' && <WelcomeScreen />}
          {walletStage === 'security' && <SecurityScreen />}
          {walletStage === 'importing' && <ImportWalletScreen />}
          {walletStage === 'creating' && <CreatingScreen />}
          {walletStage === 'seed' && <SeedScreen />}
          {walletStage === 'dashboard' && <DashboardScreen />}
          {walletStage === 'receive' && <ReceiveScreen />}
          {walletStage === 'send' && <SendScreen />}
          {walletStage === 'auth' && <AuthScreen pin={pin} setPin={setPin} setWalletStage={setWalletStage} />}
          {walletStage === 'ai' && <AiAssistantScreen setWalletStage={setWalletStage} />}
          {walletStage === 'payment' && <PaymentScreen setWalletStage={setWalletStage} />}
          {walletStage === 'earn' && <EarnScreen setWalletStage={setWalletStage} />}
          {walletStage === 'swap' && (
            <SwapScreen 
              swapAmount={swapAmount} 
              setSwapAmount={setSwapAmount} 
              fromNetwork={fromNetwork} 
              setFromNetwork={setFromNetwork} 
              toNetwork={toNetwork} 
              setToNetwork={setToNetwork} 
              setWalletStage={setWalletStage}
              prices={prices}
              balances={balances}
              swapStage={swapStage}
              setSwapStage={setSwapStage}
              swapPin={swapPin}
              setSwapPin={setSwapPin}
              txHash={txHash}
              setTxHash={setTxHash}
              seedPhrase={seedPhrase}
            />
          )}
          {walletStage === 'token_details' && TokenDetailsScreen()}
          {walletStage === 'import_token' && ImportTokenScreen()}
          {walletStage === 'list_token' && ListTokenScreen()}

          {walletStage === 'settings' && (
            <motion.div key="settings" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} style={{ maxWidth: '400px', width: '100%', margin: '0 auto', background: 'auto', minHeight: '100vh', padding: '20px' }}>
                <div style={{ display: 'flex', alignItems: 'center', marginBottom: '30px' }}>
                    <div onClick={() => setWalletStage('dashboard')} style={{ padding: '5px', cursor: 'pointer', color: 'var(--text-main)' }}>&larr;</div>
                    <h2 style={{ margin: '0 auto', fontSize: '1.2rem', paddingRight: '20px', color: 'var(--text-main)' }}>Ayarlar</h2>
                </div>
                
                <div style={{ display: 'flex', flexDirection: 'column', color: 'var(--text-main)' }}>
                   {/* WalletConnect */}
                   <div onClick={() => alert('WalletConnect altyapısı Blockchain entegrasyonu sonrası aktif edilecek.')} style={{ display: 'flex', alignItems: 'center', gap: '15px', padding: '18px 0', borderBottom: '1px solid var(--glass-border)', cursor: 'pointer' }}>
                      <Activity size={22} color="var(--text-muted)" />
                      <span style={{ fontSize: '1.05rem', fontWeight: 'bold' }}>WalletConnect</span>
                   </div>

                   {/* Tercihler */}
                   <div onClick={() => alert('Tercihler (Dil/Tema) blockchain sonrası eklenecek.')} style={{ display: 'flex', alignItems: 'center', gap: '15px', padding: '18px 0', borderBottom: '1px solid var(--glass-border)', cursor: 'pointer' }}>
                      <ShieldCheck size={22} color="var(--text-muted)" />
                      <span style={{ fontSize: '1.05rem', fontWeight: 'bold' }}>Tercihler</span>
                   </div>

                   {/* Güvenlik */}
                   <div onClick={() => alert('Güvenlik Modülü (Şifre Değiştirme, Tohum Kelimeler, 2FA) akıllı kontrattan sonra bağlanacak.')} style={{ display: 'flex', alignItems: 'center', gap: '15px', padding: '18px 0', borderBottom: '1px solid var(--glass-border)', cursor: 'pointer' }}>
                      <Lock size={22} color="var(--text-muted)" />
                      <span style={{ fontSize: '1.05rem', fontWeight: 'bold' }}>Güvenlik</span>
                   </div>

                   {/* Bildirimler */}
                   <div onClick={() => alert('Bildirimler yakında.')} style={{ display: 'flex', alignItems: 'center', gap: '15px', padding: '18px 0', borderBottom: '1px solid var(--glass-border)', cursor: 'pointer' }}>
                      <Activity size={22} color="var(--text-muted)" />
                      <span style={{ fontSize: '1.05rem', fontWeight: 'bold' }}>Bildirimler</span>
                   </div>

                   <div style={{ marginTop: '20px' }} />

                   {/* Yardım Merkezi */}
                   <div onClick={() => alert('Yardım Merkezi hazırlanıyor.')} style={{ display: 'flex', alignItems: 'center', gap: '15px', padding: '18px 0', borderBottom: '1px solid var(--glass-border)', cursor: 'pointer' }}>
                      <Info size={22} color="var(--text-muted)" />
                      <span style={{ fontSize: '1.05rem', fontWeight: 'bold' }}>Yardım Merkezi</span>
                   </div>

                   {/* Destek */}
                   <div onClick={() => alert('Destek sayfası yakında.')} style={{ display: 'flex', alignItems: 'center', gap: '15px', padding: '18px 0', borderBottom: '1px solid var(--glass-border)', cursor: 'pointer' }}>
                      <Activity size={22} color="var(--text-muted)" />
                      <span style={{ fontSize: '1.05rem', fontWeight: 'bold' }}>Destek</span>
                   </div>

                   {/* Hakkında */}
                   <div onClick={() => alert('QAI Wallet v1.0.0 - Web4 the Future!')} style={{ display: 'flex', alignItems: 'center', gap: '15px', padding: '18px 0', borderBottom: '1px solid var(--glass-border)', cursor: 'pointer' }}>
                      <ShieldCheck size={22} color="var(--text-muted)" />
                      <span style={{ fontSize: '1.05rem', fontWeight: 'bold' }}>Hakkında</span>
                   </div>

                   <div style={{ marginTop: '20px' }} />

                   {/* X */}
                   <div onClick={() => alert('X profiline gidiliyor.')} style={{ display: 'flex', alignItems: 'center', gap: '15px', padding: '18px 0', borderBottom: '1px solid var(--glass-border)', cursor: 'pointer' }}>
                      <X size={22} color="var(--text-muted)" />
                      <span style={{ fontSize: '1.05rem', fontWeight: 'bold' }}>X</span>
                   </div>

                   {/* Telegram */}
                   <div onClick={() => alert('Telegram grubuna gidiliyor.')} style={{ display: 'flex', alignItems: 'center', gap: '15px', padding: '18px 0', borderBottom: '1px solid var(--glass-border)', cursor: 'pointer' }}>
                      <Send size={22} color="var(--text-muted)" />
                      <span style={{ fontSize: '1.05rem', fontWeight: 'bold' }}>Telegram</span>
                   </div>

                   {/* Facebook */}
                   <div onClick={() => alert('Facebook sayfasına gidiliyor.')} style={{ display: 'flex', alignItems: 'center', gap: '15px', padding: '18px 0', borderBottom: '1px solid var(--glass-border)', cursor: 'pointer' }}>
                      <Activity size={22} color="var(--text-muted)" />
                      <span style={{ fontSize: '1.05rem', fontWeight: 'bold' }}>Facebook</span>
                   </div>
                </div>

                <div style={{ marginTop: '30px' }}>
                   <h3 style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginBottom: '10px' }}>Hızlı Tema Kontrolü (Geliştirici)</h3>
                   <div style={{ display: 'flex', gap: '10px', overflowX: 'auto', paddingBottom: '15px' }}>
                       {[{id: 'dark', n: 'Koyu'}, {id: 'light', n: 'Açık'}, {id: 'taste-aura', n: 'Aura'}, {id: 'cyber-neon', n: 'Neon'}, {id: 'ocean-blue', n: 'Okyanus'}, {id: 'royal-gold', n: 'Gold'}].map(thm => (
                           <div key={thm.id} onClick={() => setTheme(thm.id)} style={{ padding: '10px 15px', borderRadius: '12px', background: theme === thm.id ? 'var(--primary)' : 'rgba(128,128,128,0.1)', cursor: 'pointer', whiteSpace: 'nowrap', fontWeight: 'bold', fontSize: '0.8rem', color: 'var(--text-main)' }}>{thm.n}</div>
                       ))}
                   </div>
                </div>

                <button onClick={() => { localStorage.removeItem('taste_wallet_seed'); setWalletStage('welcome'); }} style={{ width: '100%', marginTop: '30px', padding: '15px', background: 'rgba(255, 59, 48, 0.1)', color: '#ff3b30', border: '1px solid #ff3b30', borderRadius: '12px', fontWeight: 'bold' }}>Cüzdandan Çıkış Yap</button>
            </motion.div>
          )}

          {walletStage === 'trending' && (
              <motion.div key="trending" initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ maxWidth: '450px', width: '100%', padding: '20px', margin: '0 auto', paddingBottom: '110px' }}>
                  <h2 style={{ textAlign: 'center', marginBottom: '20px', fontSize: '1.2rem', fontWeight: 'bold' }}>{t.trendingData}</h2>
                  
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
                     <h3 style={{ fontSize: '1rem', color: 'var(--primary)', display: 'flex', alignItems: 'center', gap: '5px' }}><Flame size={18} /> {lang === 'tr' ? 'Sponsorlu / Tanıtılanlar' : 'Promoted Spotlights'}</h3>
                     <span style={{ fontSize: '0.7rem', background: 'rgba(255,255,255,0.1)', padding: '2px 6px', borderRadius: '4px', color: 'var(--text-muted)' }}>Ad</span>
                  </div>
                  
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '15px', marginBottom: '30px' }}>
                    {[
                      { name: 'CatWifHat', ca: 'Pump.fun', vol: '$1.4M', change: '+345%', logo: '#FFD700', hrs: '42s' },
                      { name: 'DOGE AI', ca: 'Pinksale', vol: '$890K', change: '+120%', logo: '#EAB308', hrs: '12s' },
                      { name: 'SolGPT', ca: 'Raydium', vol: '$2.1M', change: '+88%', logo: '#9945FF', hrs: '23s' }
                    ].map((coin, idx) => (
                      <div key={idx} style={{ background: 'var(--bg-card)', border: '1px solid var(--primary)', borderRadius: '16px', padding: '15px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', boxShadow: '0 0 10px rgba(255,69,0,0.15)' }}>
                        <div style={{ display: 'flex', gap: '15px', alignItems: 'center' }}>
                           <div style={{ width: '45px', height: '45px', borderRadius: '50%', background: coin.logo, display:'flex', justifyContent:'center', alignItems:'center', position: 'relative' }}>
                             <div style={{ position: 'absolute', top: -5, right: -5, background: 'var(--primary)', color: 'white', fontSize: '0.55rem', padding: '2px 5px', borderRadius: '5px', fontWeight: 'bold' }}>PROMO</div>
                           </div>
                           <div>
                             <p style={{ fontWeight: 'bold', fontSize: '1.1rem' }}>{coin.name}</p>
                             <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{coin.ca} | {coin.hrs} left</p>
                           </div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <p style={{ fontWeight: 'bold', fontSize: '1.1rem', color: '#4cd964' }}>{coin.change}</p>
                          <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Vol: {coin.vol}</p>
                        </div>
                      </div>
                    ))}
                  </div>

                  <h3 style={{ fontSize: '1rem', marginBottom: '15px', color: 'var(--text-muted)' }}>Global Top (CMC)</h3>
                  <div style={{ marginTop: '10px', padding: '20px', background: 'rgba(128,128,128,0.1)', borderRadius: '16px', textAlign: 'center', border: '1px solid var(--glass-border)' }}>
                      <TrendingUp size={40} color="var(--primary)" style={{ marginBottom: '10px' }} />
                      <h3 style={{ marginTop: '10px', fontSize: '1.2rem', color: '#4cd964' }}>Bitcoin (BTC)</h3>
                      <h2 style={{ margin: '10px 0', fontSize: '2rem' }}>₺2,140,500</h2>
                      <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>24h Hacim: $42,150,000,000</p>
                  </div>
                  <button onClick={() => setWalletStage('list_token')} style={{ width: '100%', padding: '15px', background: 'var(--text-main)', color: 'var(--bg-main)', borderRadius: '14px', border: 'none', fontWeight: 'bold', marginTop: '20px', cursor: 'pointer', fontSize: '1rem' }}>
                     {lang === 'tr' ? '🔥 Kendi Projeni Reklam Ver' : '🔥 Promote Your Project'}
                  </button>
              </motion.div>
          )}
          {/* Duplicate renders removed - handled above */}
          {walletStage === 'earn' && (
            <motion.div key="earn" style={{ maxWidth: '450px', width: '100%', padding: '20px', margin: '0 auto', paddingBottom: '110px' }}>
              <h2 style={{ textAlign: 'center', marginBottom: '20px' }}>{t.stakingTitle}</h2>
              <div style={{ background: 'rgba(76,217,100,0.1)', padding: '15px', borderRadius: '12px', border: '1px solid rgba(76,217,100,0.3)', marginBottom: '20px', fontSize: '0.8rem', color: '#4cd964' }}>
                <Info size={14} style={{ verticalAlign: 'middle', marginRight: '5px' }} />
                {t.stakingInfo}
              </div>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                {[
                  { name: 'Solana Staking', apy: '%7.10 - %8.50', logo: '#9945FF' },
                  { name: 'Ethereum 2.0', apy: '%3.50 - %4.20', logo: '#627EEA' },
                  { name: 'Bitcoin', apy: '%0.50 - %1.10', logo: '#F7931A' },
                  { name: 'TON Staking', apy: '%4.80 - %6.20', logo: '#0098EA' },
                  { name: 'BNB Vault', apy: '%2.40 - %3.80', logo: '#F3BA2F' },
                  { name: 'Base Liquidity', apy: '%12.40+', logo: '#0052FF' },
                  { name: 'Monad Staking', apy: '%18.00+', logo: '#836EF9' },
                  { name: 'Tron Energy', apy: '%10.00 - %15.00', logo: '#FF060A' }
                ].map((s, i) => (
                  <div key={i} style={{ background: 'var(--bg-card)', padding: '15px', borderRadius: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', border: '1px solid var(--glass-border)' }}>
                    <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                        <div style={{ width: '35px', height: '35px', borderRadius: '50%', background: s.logo }}></div>
                        <div><p style={{ fontWeight: 'bold' }}>{s.name}</p><p style={{ fontSize: '0.75rem', color: '#4cd964' }}>APY: {s.apy}</p></div>
                    </div>
                    <button style={{ background: 'var(--text-main)', color: 'var(--bg-main)', padding: '8px 15px', borderRadius: '10px', fontSize: '0.8rem', border: 'none', fontWeight: 'bold', cursor: 'pointer' }}>Stake</button>
                  </div>
                ))}
              </div>
            </motion.div>
          )}
          
          {walletStage === 'discover' && (
              <motion.div key="discover" initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ maxWidth: '450px', width: '100%', padding: '20px', margin: '0 auto', paddingBottom: '110px' }}>
                <div style={{ width: '100%' }}>
                  <h2 style={{ textAlign: 'center', fontSize: '1.2rem', marginBottom: '20px' }}>{t.discover} & dApps</h2>
                  <div onClick={() => setWalletStage('list_token')} style={{ background: 'linear-gradient(90deg, #8A2BE2, #ffb347)', padding: '20px', borderRadius: '16px', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', marginBottom: '20px' }}>
                    <div>
                      <h3 style={{ margin: 0, fontSize: '1.1rem' }}>🎫 {t.listYourCoin}</h3>
                      <p style={{ margin: 0, fontSize: '0.8rem', marginTop: '4px', opacity: 0.9 }}>{t.listDesc}</p>
                    </div>
                    <Sparkles size={24} />
                  </div>
                  <h3 style={{ fontSize: '1.2rem', marginTop: '25px', marginBottom: '15px' }}>{lang === 'tr' ? 'Swaplar (Merkeziyetsiz Takas)' : 'Swaps (Cross-Chain Dex)'}</h3>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                    {[
                      { name: 'STON.fi', sub: 'TON Network DEX', logo: '#0098EA' },
                      { name: 'Uniswap', sub: 'Ethereum DEX', logo: '#FF007A' },
                      { name: 'Raydium AMM', sub: 'Solana Order Book', logo: '#9945FF' },
                      { name: 'PancakeSwap', sub: 'BSC Core DEX', logo: '#D1884F' }
                    ].map((dapp, idx) => (
                      <div key={'s'+idx} style={{ display: 'flex', alignItems: 'center', gap: '15px', background: 'rgba(128,128,128,0.1)', padding: '10px', borderRadius: '12px', border: '1px solid var(--glass-border)' }}>
                        <div style={{ width: '40px', height: '40px', borderRadius: '50%', background: dapp.logo, display:'flex', justifyContent:'center', alignItems:'center' }}></div>
                        <div>
                          <h4 style={{ fontSize: '1rem', margin: 0 }}>{dapp.name}</h4>
                          <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: 0, marginTop: '2px' }}>{dapp.sub}</p>
                        </div>
                        <div style={{ marginLeft: 'auto', background: 'var(--text-main)', color: 'var(--bg-main)', padding: '6px 12px', borderRadius: '10px', fontSize: '0.7rem', cursor: 'pointer', fontWeight: 'bold' }}>{t.connect}</div>
                      </div>
                    ))}
                  </div>

                  <h3 style={{ fontSize: '1.2rem', marginTop: '30px', marginBottom: '15px' }}>{lang === 'tr' ? 'Havuzlar & AMM (Ağ Kilitleri)' : 'Pools & AMM (Liquidity)'}</h3>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                    {[
                      { name: 'STON.fi', sub: 'TON Network DEX', logo: '#0098EA' },
                      { name: 'Uniswap', sub: 'Ethereum DEX', logo: '#FF007A' },
                      { name: 'Raydium AMM', sub: 'Solana Order Book', logo: '#9945FF' },
                      { name: 'PancakeSwap', sub: 'BSC Core DEX', logo: '#D1884F' },
                      { name: 'Aerodrome', sub: 'Base Native DEX', logo: '#0052FF' },
                      { name: 'Jupiter', sub: 'Solana Aggregator', logo: '#14F195' },
                      { name: 'Curve Finance', sub: 'Stablecoin DEX', logo: '#000000' }
                    ].map((dapp, idx) => (
                      <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '15px', background: 'rgba(128,128,128,0.1)', padding: '10px', borderRadius: '12px', border: '1px solid var(--glass-border)' }}>
                        <div style={{ width: '40px', height: '40px', borderRadius: '50%', background: dapp.logo, display:'flex', justifyContent:'center', alignItems:'center' }}></div>
                        <div>
                          <h4 style={{ fontSize: '1rem', margin: 0 }}>{dapp.name}</h4>
                          <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: 0, marginTop: '2px' }}>{dapp.sub}</p>
                        </div>
                        <div style={{ marginLeft: 'auto', background: 'var(--text-main)', color: 'var(--bg-main)', padding: '6px 12px', borderRadius: '10px', fontSize: '0.7rem', cursor: 'pointer', fontWeight: 'bold' }}>{t.connect}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </motion.div>
          )}
          {/* End of stages */}
        </AnimatePresence>
      </div>
      {TradeMenuPopup()}
      {BottomNav()}
    </div>
  );
}

export default App;

const AuthScreen = ({ pin, setPin, setWalletStage }) => {
  return (
    <motion.div key="auth" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="glass-panel" style={{ maxWidth: '400px', width: '100%', padding: '30px', margin: 'auto', textAlign: 'center', display: 'flex', flexDirection: 'column', justifyContent: 'center', minHeight: '100vh', background: 'var(--bg-main)' }}>
      <Lock size={60} color="#4cd964" style={{ margin: '0 auto 20px auto' }} />
      <h2 style={{ fontSize: '1.5rem', marginBottom: '10px' }}>Hoş Geldiniz</h2>
      <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '30px' }}>Devam etmek için PIN kodunuzu girin</p>
      
      <div style={{ display: 'flex', justifyContent: 'center', gap: '15px', marginBottom: '40px' }}>
         {[1,2,3,4,5,6].map((i) => (
           <div key={i} style={{ width: '15px', height: '15px', borderRadius: '50%', background: pin.length >= i ? '#4cd964' : 'rgba(128,128,128,0.3)', transition: 'background 0.2s' }} />
         ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px', maxWidth: '280px', margin: '0 auto' }}>
         {[1,2,3,4,5,6,7,8,9].map(num => (
           <div key={num} onClick={() => {
              if (pin.length < 6) {
                 const newPin = pin + num;
                 setPin(newPin);
                 if (newPin.length === 6) {
                    setTimeout(() => { if (newPin === '123456' || newPin.length===6) setWalletStage('dashboard'); else { setPin(''); alert('Yanlış PIN!'); } }, 300);
                 }
              }
           }} style={{ width: '60px', height: '60px', borderRadius: '50%', background: 'rgba(128,128,128,0.1)', display: 'flex', justifyContent: 'center', alignItems: 'center', fontSize: '1.5rem', cursor: 'pointer', margin: '0 auto' }}>{num}</div>
         ))}
         <div></div>
         <div onClick={() => {
            if(pin.length < 6) {
               const newPin = pin + '0';
               setPin(newPin);
               if (newPin.length === 6) setTimeout(() => { if (newPin === '123456' || newPin.length===6) setWalletStage('dashboard'); }, 300);
            }
         }} style={{ width: '60px', height: '60px', borderRadius: '50%', background: 'rgba(128,128,128,0.1)', display: 'flex', justifyContent: 'center', alignItems: 'center', fontSize: '1.5rem', cursor: 'pointer', margin: '0 auto' }}>0</div>
         <div onClick={() => setPin(pin.slice(0,-1))} style={{ width: '60px', height: '60px', borderRadius: '50%', display: 'flex', justifyContent: 'center', alignItems: 'center', cursor: 'pointer', margin: '0 auto' }}><X size={24} /></div>
      </div>
      
      <div style={{ marginTop: '40px', color: '#4cd964', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
         <Activity size={20} /> Biyometrik Giriş (Parmak İzi)
      </div>
    </motion.div>
  );
};

const SwapScreen = ({ swapAmount, setSwapAmount, fromNetwork, setFromNetwork, toNetwork, setToNetwork, setWalletStage, prices, balances, swapStage, setSwapStage, swapPin, setSwapPin, txHash, setTxHash, seedPhrase }) => {
    const netToCoin = {
      'Solana (SOL)': 'sol',
      'Ethereum (ETH)': 'eth',
      'Bitcoin (BTC)': 'btc',
      'TON': 'ton',
      'Tron (TRX)': 'trx',
      'BNB': 'bnb',
      'Base': 'eth',
      'Monad': 'eth'
    };
    
    const fallbackUSD = { 'solana': 140, 'ethereum': 3500, 'bitcoin': 65000, 'toncoin': 5.2, 'tron': 0.12, 'binancecoin': 580 };
    
    const [realOutAmount, setRealOutAmount] = useState(null);
    const [quoteLoading, setQuoteLoading] = useState(false);

    const fromCoinId = netToCoin[fromNetwork] || 'solana';
    const toCoinId = netToCoin[toNetwork] || 'tron';
    
    const fromPrice = (prices[fromCoinId] && prices[fromCoinId].usd) ? prices[fromCoinId].usd : (fallbackUSD[fromCoinId] || 1);
    const toPrice = (prices[toCoinId] && prices[toCoinId].usd) ? prices[toCoinId].usd : (fallbackUSD[toCoinId] || 1);
    const inputValNum = parseFloat(swapAmount) || 0;
    const outputValNum = inputValNum * (fromPrice / toPrice);
    let outputValStr = outputValNum > 0 ? outputValNum.toFixed(6) : '';
    
    useEffect(() => {
       if (inputValNum <= 0) {
          setRealOutAmount(null);
          return;
       }

       const getWeiStr = (val, dec) => {
          let [intP, fracP] = val.toString().split('.');
          if(!fracP) fracP = '';
          if(fracP.length > dec) fracP = fracP.slice(0, dec);
          return intP + fracP.padEnd(dec, '0');
       };

       if (fromNetwork === 'Solana (SOL)' && toNetwork === 'Solana (SOL)') {
          setQuoteLoading(true);
          fetch(`https://quote-api.jup.ag/v6/quote?inputMint=So11111111111111111111111111111111111111112&outputMint=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v&amount=${Math.floor(inputValNum * 1e9)}&slippageBps=50`)
          .then(res => res.json())
          .then(data => { if (data && data.outAmount) setRealOutAmount(data.outAmount / 1e6); })
          .catch(e => console.error("Jupiter API Hatası:", e))
          .finally(() => setQuoteLoading(false));
       } 
       else if (fromNetwork === 'Ethereum (ETH)' && toNetwork === 'Ethereum (ETH)') {
          setQuoteLoading(true);
          const amountInWei = getWeiStr(inputValNum, 18);
          fetch(`https://aggregator-api.kyberswap.com/ethereum/api/v1/routes?tokenIn=0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE&tokenOut=0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48&amountIn=${amountInWei}`)
          .then(res => res.json())
          .then(data => { if (data && data.data && data.data.routeSummary) setRealOutAmount(data.data.routeSummary.amountOut / 1e6); })
          .catch(e => console.error("Kyber API Hatası:", e))
          .finally(() => setQuoteLoading(false));
       }
       else if (fromNetwork === 'BNB Smart Chain' && toNetwork === 'BNB Smart Chain') {
          setQuoteLoading(true);
          const amountInWei = getWeiStr(inputValNum, 18);
          fetch(`https://aggregator-api.kyberswap.com/bsc/api/v1/routes?tokenIn=0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE&tokenOut=0x55d398326f99059fF775485246999027B3197955&amountIn=${amountInWei}`)
          .then(res => res.json())
          .then(data => { if (data && data.data && data.data.routeSummary) setRealOutAmount(data.data.routeSummary.amountOut / 1e18); })
          .catch(e => console.error("Kyber API Hatası:", e))
          .finally(() => setQuoteLoading(false));
       }
       else if (fromNetwork === 'TON' && toNetwork === 'TON') {
          setRealOutAmount(inputValNum * (prices.toncoin?.usd || 5.2));
       }
       else if (fromNetwork === 'Tron (TRX)' && toNetwork === 'Tron (TRX)') {
          setRealOutAmount(inputValNum * (prices.tron?.usd || 0.12));
       }
       else {
          setRealOutAmount(null);
       }
    }, [fromNetwork, toNetwork, inputValNum, prices]);

    if (realOutAmount !== null && realOutAmount > 0) {
       outputValStr = realOutAmount.toFixed(4) + (fromNetwork === 'BNB Smart Chain' ? ' USDT (Canlı)' : ' USDC (Canlı)');
    }

    const handleSwapRequest = () => {
      if(!inputValNum || inputValNum <= 0) return alert('Lütfen geçerli bir miktar girin.');
      setSwapStage('signing');
      setSwapPin('');
    };
    
    const generateTxHash = (net) => {
       const base58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
       let hash = '';
       if(net.includes('Solana')) { for(let i=0;i<88;i++) hash += base58[Math.floor(Math.random() * base58.length)]; return hash; }
       if(net.includes('TON')) { return 'EQ' + [...Array(46)].map(() => base58[Math.floor(Math.random() * base58.length)]).join(''); }
       return '0x' + [...Array(64)].map(() => '0123456789abcdef'[Math.floor(Math.random() * 16)]).join('');
    };

    const confirmSwap = async () => {
       setSwapStage('processing');
       
       // Real Private Key derivation for signing simulation
       try {
          const phrase = seedPhrase.join(' ');
          let sig = "0x...";
          if (fromNetwork.includes('ETH') || fromNetwork.includes('BNB') || fromNetwork.includes('EVM')) {
             const wallet = EthersWallet.fromPhrase(phrase);
             sig = await wallet.signMessage(`Swap ${swapAmount} ${fromNetwork} to ${toNetwork}`);
          } else if (fromNetwork.includes('Solana')) {
             const seed = await bip39Lib.mnemonicToSeed(phrase);
             const hd = HDKey.fromMasterSeed(seed);
             const child = hd.derive("m/44'/501'/0'/0'");
             const keypair = Keypair.fromSeed(child.privateKey.slice(0, 32));
             sig = "SOL_SIG_" + btoa(keypair.publicKey.toBase58()).substring(0, 32);
          } else if (fromNetwork.includes('TON')) {
             const keyPair = await mnemonicToKeyPair(phrase.split(' '));
             sig = "TON_SIG_" + btoa(Uint8Array.from(keyPair.publicKey).join(',')).substring(0, 32);
          }
          console.log("Transaction Signed with Sig:", sig);
       } catch (e) {
          console.error("Signing failed:", e);
       }

       setTimeout(() => {
          setTxHash(generateTxHash(fromNetwork));
          setSwapStage('success');
       }, 3500);
    };

    return (
    <motion.div key="swap" initial={{ opacity: 0, y: 50 }} animate={{ opacity: 1, y: 0 }} className="glass-panel" style={{ maxWidth: '450px', width: '100%', padding: '20px', display: 'flex', flexDirection: 'column', gap: '20px', margin: 'auto', minHeight: '100vh', background: 'var(--bg-main)' }}>
      {swapStage === 'success' ? (
        <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', minHeight: '300px' }}>
          <div style={{ width: '80px', height: '80px', borderRadius: '50%', background: '#4cd964', display: 'flex', justifyContent: 'center', alignItems: 'center', marginBottom: '20px' }}>
             <CheckCircle2 size={40} color="black" />
          </div>
          <h2 style={{ margin: 0, color: 'var(--text-main)', textAlign: 'center' }}>İşlem Başarılı!</h2>
          <p style={{ color: 'var(--text-muted)', textAlign: 'center', marginTop: '10px' }}>{inputValNum} {fromNetwork.split(' ')[0]} <br/> başarıyla {toNetwork.split(' ')[0]} ağına aktarıldı.</p>
          <div style={{ background: 'rgba(128,128,128,0.1)', padding: '15px', borderRadius: '12px', marginTop: '20px', width: '100%', wordBreak: 'break-all', textAlign: 'center', border: '1px solid var(--glass-border)' }}>
             <p style={{ margin: '0 0 5px 0', fontSize: '0.8rem', color: 'var(--text-muted)' }}>İşlem Özeti (TxHash)</p>
             <p style={{ margin: 0, color: 'var(--primary)', fontSize: '0.85rem' }}>{txHash}</p>
          </div>
          <button style={{ width: '100%', background: 'var(--text-main)', color: 'var(--bg-main)', padding: '15px', borderRadius: '12px', marginTop: '30px', fontWeight: 'bold', border: 'none', cursor: 'pointer' }} onClick={() => { setSwapStage('input'); setSwapAmount(''); setWalletStage('dashboard'); }}>Ana Sayfaya Dön</button>
        </motion.div>
      ) : swapStage === 'signing' || swapStage === 'processing' ? (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', minHeight: '300px' }}>
           {swapStage === 'processing' ? (
              <>
                 <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1.5, ease: 'linear' }}><RefreshCw size={50} color="var(--primary)" /></motion.div>
                 <h3 style={{ color: 'var(--text-main)', marginTop: '20px' }}>Akıllı Kontrat Yürütülüyor...</h3>
                 <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>İmzanız ağa gönderiliyor. (Zk-Snarks)</p>
              </>
           ) : (
              <>
                 <h3 style={{ color: 'var(--text-main)', marginBottom: '10px' }}>İşlemi İmzala</h3>
                 <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '30px' }}>Devam etmek için PIN'inizi girin.</p>
                 <div style={{ display: 'flex', justifyContent: 'center', gap: '15px', marginBottom: '40px' }}>
                    {[1,2,3,4,5,6].map((i) => (
                      <div key={i} style={{ width: '15px', height: '15px', borderRadius: '50%', background: swapPin.length >= i ? '#4cd964' : 'rgba(128,128,128,0.3)', transition: 'background 0.2s' }} />
                    ))}
                 </div>
                 <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px', maxWidth: '280px', margin: '0 auto' }}>
                    {[1,2,3,4,5,6,7,8,9].map(num => (
                      <div key={num} onClick={() => {
                         if (swapPin.length < 6) {
                            const newPin = swapPin + num;
                            setSwapPin(newPin);
                            if (newPin.length === 6) setTimeout(() => { if (newPin === '123456') confirmSwap(); else { alert('Hatalı PIN!'); setSwapPin(''); } }, 300);
                         }
                      }} style={{ width: '60px', height: '60px', borderRadius: '50%', background: 'rgba(128,128,128,0.1)', display: 'flex', justifyContent: 'center', alignItems: 'center', fontSize: '1.5rem', cursor: 'pointer', margin: '0 auto', color: 'var(--text-main)' }}>{num}</div>
                    ))}
                    <div></div>
                    <div onClick={() => {
                       if(swapPin.length < 6) {
                          const newPin = swapPin + '0';
                          setSwapPin(newPin);
                          if (newPin.length === 6) setTimeout(() => { if (newPin === '123456') confirmSwap(); else { alert('Hatalı PIN!'); setSwapPin(''); } }, 300);
                       }
                    }} style={{ width: '60px', height: '60px', borderRadius: '50%', background: 'rgba(128,128,128,0.1)', display: 'flex', justifyContent: 'center', alignItems: 'center', fontSize: '1.5rem', cursor: 'pointer', margin: '0 auto', color: 'var(--text-main)' }}>0</div>
                    <div onClick={() => setSwapPin(swapPin.slice(0,-1))} style={{ width: '60px', height: '60px', borderRadius: '50%', display: 'flex', justifyContent: 'center', alignItems: 'center', cursor: 'pointer', margin: '0 auto', color: 'var(--text-main)' }}><X size={24} /></div>
                 </div>
                 <div style={{ marginTop: '40px', cursor: 'pointer', color: '#ff3b30', fontWeight: 'bold' }} onClick={() => setSwapStage('input')}>İptal Et</div>
              </>
           )}
        </motion.div>
      ) : (
      <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ cursor: 'pointer', color: 'var(--text-muted)', fontWeight: 'bold', padding: '5px' }} onClick={() => setWalletStage('dashboard')}>&larr; Geri</div>
        <h2 style={{ fontSize: '1.2rem', fontWeight: 'bold' }}>{fromNetwork === toNetwork ? 'Merkeziyetsiz Takas' : 'Çapraz Ağ Köprüsü'}</h2>
        <div><Activity size={20} color="var(--primary)" /></div>
      </div>
      <div style={{ background: 'rgba(255,179,71,0.1)', border: '1px solid rgba(255,179,71,0.3)', padding: '10px 15px', borderRadius: '12px', fontSize: '0.8rem', color: '#ffb347' }}>
         <Info size={14} style={{ display: 'inline', verticalAlign: 'middle', marginRight: '5px' }} />
         <strong>{fromNetwork === toNetwork ? 'DEX Swap:' : 'Bridge:'}</strong> {fromNetwork.split(' ')[0]} &rarr; {
           fromNetwork === 'Solana (SOL)' && toNetwork === 'Solana (SOL)' ? 'USDC (Canlı Jupiter)' : 
           fromNetwork === 'Ethereum (ETH)' && toNetwork === 'Ethereum (ETH)' ? 'USDC (Canlı KyberSwap)' : 
           fromNetwork === 'BNB Smart Chain' && toNetwork === 'BNB Smart Chain' ? 'USDT (Canlı KyberSwap)' : 
           toNetwork.split(' ')[0]
         } 
      </div>
      <div style={{ background: 'rgba(128,128,128,0.1)', borderRadius: '16px', padding: '20px', border: '1px solid var(--glass-border)', position: 'relative' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Ödeyeceğiniz (Verilen)</span>
          <select value={fromNetwork} onChange={e => setFromNetwork(e.target.value)} style={{ fontSize: '0.85rem', color: 'white', background: 'rgba(128,128,128,0.3)', padding: '4px 8px', borderRadius: '8px', border: 'none', outline: 'none' }}>
              <option value="Solana (SOL)">🟣 Solana (SOL)</option>
              <option value="Ethereum (ETH)">🔵 Ethereum (ETH)</option>
              <option value="Bitcoin (BTC)">🟠 Bitcoin (BTC)</option>
              <option value="TON">🔵 TON Network</option>
              <option value="Tron (TRX)">🔴 Tron (TRX)</option>
              <option value="BNB">🟡 BNB Smart Chain</option>
          </select>
        </div>
        <input type="number" placeholder="0.00" value={swapAmount} onChange={e => setSwapAmount(e.target.value)} style={{ background: 'transparent', border: 'none', color: 'var(--text-main)', fontSize: '2rem', width: '100%', outline: 'none', fontWeight: 'bold', marginTop: '10px' }} />
        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '5px' }}>Bakiye: {(balances[fromCoinId] || 0).toFixed(4)} {fromNetwork.split(' ')[0]}</div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'center', margin: '-15px 0', zIndex: 5 }}>
        <motion.div whileTap={{ scale: 0.8 }} onClick={() => { const temp = fromNetwork; setFromNetwork(toNetwork); setToNetwork(temp); setSwapAmount(outputValStr); }} style={{ background: 'var(--primary)', padding: '10px', borderRadius: '50%', border: '2px solid var(--bg-main)', cursor: 'pointer', boxShadow: '0 0 10px rgba(0,0,0,0.5)' }}><ArrowRightLeft size={20} color="white" style={{ transform: 'rotate(90deg)' }} /></motion.div>
      </div>
      <div style={{ background: 'rgba(128,128,128,0.1)', borderRadius: '16px', padding: '20px', border: '1px solid var(--glass-border)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Alacağınız (Tahmini)</span>
          <select value={toNetwork} onChange={e => setToNetwork(e.target.value)} style={{ fontSize: '0.85rem', color: 'white', background: 'rgba(128,128,128,0.3)', padding: '4px 8px', borderRadius: '8px', border: 'none', outline: 'none' }}>
              <option value="Tron (TRX)">🔴 Tron (TRX)</option>
              <option value="Solana (SOL)">🟣 Solana (SOL)</option>
              <option value="Ethereum (ETH)">🔵 Ethereum (ETH)</option>
              <option value="Bitcoin (BTC)">🟠 Bitcoin (BTC)</option>
              <option value="TON">🔵 TON Network</option>
              <option value="BNB">🟡 BNB Smart Chain</option>
          </select>
        </div>
        <input type="text" readOnly placeholder={quoteLoading ? "Canlı piyasa fiyatı çekiliyor..." : "0.00"} value={quoteLoading ? '' : outputValStr} style={{ background: 'transparent', border: 'none', color: '#4cd964', fontSize: quoteLoading ? '1rem' : '2rem', width: '100%', outline: 'none', fontWeight: 'bold', marginTop: '10px' }} />
      </div>
      <div style={{ background: 'rgba(128,128,128,0.05)', padding: '15px', borderRadius: '12px', border: '1px solid var(--glass-border)', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
         <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}><span>İşlem Türü</span><span style={{ color: 'var(--text-main)', fontWeight: 'bold' }}>{fromNetwork === toNetwork ? 'Merkeziyetsiz Takas (DEX)' : 'Çapraz Ağ Köprüsü (Bridge)'}</span></div>
         <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}><span>Kur Oranı</span>{realOutAmount !== null && inputValNum > 0 ? (<span style={{ color: '#4cd964', fontWeight: 'bold' }}>1 {fromNetwork.split(' ')[0]} ≈ {(realOutAmount / inputValNum).toFixed(4)} {fromNetwork === 'BNB Smart Chain' ? 'USDT' : 'USDC'} (Canlı)</span>) : (<span style={{ color: 'var(--text-main)', fontWeight: 'bold' }}>1 {fromNetwork.split(' ')[0]} ≈ {(fromPrice / toPrice).toFixed(4)} {toNetwork.split(' ')[0]}</span>)}</div>
         <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Ağ Ücreti (Tahmini)</span>{fromNetwork === toNetwork ? (<span style={{ color: '#4cd964', fontWeight: 'bold' }}>≈ $0.45</span>) : (<span style={{ color: '#ffb347', fontWeight: 'bold' }}>≈ {fromNetwork.includes('Ethereum') ? '$12.50' : (fromNetwork.includes('Tron') ? '$1.10' : (fromNetwork.includes('Solana') ? '$0.05' : '$0.20'))} (Bridge Fee)</span>)}</div>
      </div>
      <button style={{ background: (!inputValNum || inputValNum <= 0) ? 'rgba(128,128,128,0.3)' : '#4cd964', color: 'black', padding: '18px', borderRadius: '14px', border: 'none', fontSize: '1.1rem', fontWeight: 'bold', cursor: (!inputValNum || inputValNum <= 0) ? 'not-allowed' : 'pointer', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '10px', marginTop: '10px' }} onClick={handleSwapRequest} disabled={!inputValNum || inputValNum <= 0}>
          {fromNetwork === toNetwork ? 'Takası İmzala (Sign)' : 'Köprüyü İmzala (Bridge)'}
      </button>
      </>
      )}
    </motion.div>
  );
};

const AiAssistantScreen = ({ setWalletStage }) => (
  <motion.div key="ai" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="glass-panel" style={{ maxWidth: '450px', width: '100%', padding: '20px', margin: 'auto', minHeight: '100vh', background: 'var(--bg-main)', display: 'flex', flexDirection: 'column' }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '20px' }}>
      <div onClick={() => setWalletStage('dashboard')} style={{ cursor: 'pointer', color: 'var(--text-muted)' }}>&larr; Geri</div>
      <h2 style={{ fontSize: '1.2rem', fontWeight: 'bold' }}>TASTE AI Asistan</h2>
      <Sparkles size={20} color="var(--primary)" />
    </div>
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', gap: '20px', padding: '20px', textAlign: 'center' }}>
      <Activity size={50} color="var(--primary)" />
      <p style={{ color: 'var(--text-muted)' }}>Yapay zeka destekli portföy danışmanınız hazırlanıyor...</p>
    </div>
  </motion.div>
);

const PaymentScreen = ({ setWalletStage }) => (
  <motion.div key="payment" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="glass-panel" style={{ maxWidth: '450px', width: '100%', padding: '20px', margin: 'auto', minHeight: '100vh', background: 'var(--bg-main)' }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '20px' }}>
      <div onClick={() => setWalletStage('dashboard')} style={{ cursor: 'pointer', color: 'var(--text-muted)' }}>&larr; Geri</div>
      <h2 style={{ fontSize: '1.2rem', fontWeight: 'bold' }}>Hızlı Ödeme</h2>
      <QrCode size={20} color="var(--text-main)" />
    </div>
    <div style={{ textAlign: 'center', marginTop: '50px' }}>
      <QrCode size={150} style={{ margin: '0 auto 20px auto' }} />
      <p style={{ color: 'var(--text-muted)' }}>Ödeme yapmak veya almak için QR kodunu tarayın.</p>
    </div>
  </motion.div>
);

const EarnScreen = ({ setWalletStage }) => (
  <motion.div key="earn" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="glass-panel" style={{ maxWidth: '450px', width: '100%', padding: '20px', margin: 'auto', minHeight: '100vh', background: 'var(--bg-main)' }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '20px' }}>
      <div onClick={() => setWalletStage('dashboard')} style={{ cursor: 'pointer', color: 'var(--text-muted)' }}>&larr; Geri</div>
      <h2 style={{ fontSize: '1.2rem', fontWeight: 'bold' }}>Ödüller & Staking</h2>
      <Gift size={20} color="#FF007A" />
    </div>
    <div style={{ background: 'rgba(255, 0, 122, 0.1)', border: '1px solid #FF007A', borderRadius: '16px', padding: '20px', textAlign: 'center' }}>
      <h3 style={{ color: '#FF007A' }}>TASTE Staking</h3>
      <p style={{ fontSize: '2rem', fontWeight: 'bold', margin: '10px 0' }}>%15.5 APY</p>
      <button style={{ background: '#FF007A', color: 'white', border: 'none', padding: '10px 20px', borderRadius: '10px', fontWeight: 'bold' }}>Hemen Stake Et</button>
    </div>
  </motion.div>
);

const bip32 = require('bip32');
const bip39 = require('bip39');
const ecc = require('tiny-secp256k1');
const bitcoin = require('bitcoinjs-lib');
const {ECPairFactory} = require('ecpair');
const {logger, isValidBitcoinAddress} = require("./utils/function");
const AddressDataClass = require("./utils/AddressData");
const Request = require("./utils/Request");
const ConfigClass = require("./utils/Config");
const readline = require('node:readline/promises');

bitcoin.initEccLib(ecc);

const config = new ConfigClass('./config.yaml');
const network = config.network;
const request = new Request(config);

const exchangeRate = 1e8;

// @apidoc: https://mempool.space/signet/docs/api/rest
// @apidoc: https://mempool.fractalbitcoin.io/zh/docs/api/rest
const toXOnly = (pubKey) => pubKey.length === 32 ? pubKey : pubKey.slice(1, 33);

function getKeyPairByPrivateKey(privateKey) {
    return ECPairFactory(ecc).fromWIF(privateKey, network);
}

async function main() {
    logger().warn("加速功能开发中...");
}

main();

const fs = require("fs");
const yaml = require('js-yaml');
const bitcoin = require("bitcoinjs-lib");

class Config {
    constructor(filePath = "config.yaml") {
        this.data = yaml.load(fs.readFileSync(filePath, 'utf8'));
        this.networkType = this.data.networkType;

        switch (this.data.networkType) {
            case "mainnet":
            default:
                this.networkType = "mainnet";
                this.unisatWalletUri = "https://wallet-api.unisat.io";
                this.mempoolUri = "https://mempool.space";
                this.network = bitcoin.networks.bitcoin;
                break;
            case "testnet":
                this.unisatWalletUri = "https://wallet-api-testnet.unisat.io";
                this.mempoolUri = "https://mempool.space/testnet";
                this.network = bitcoin.networks.testnet;
                break;
            case "testnet4":
                this.unisatWalletUri = "https://wallet-api-testnet4.unisat.io";
                this.mempoolUri = "https://mempool.space/testnet4";
                this.network = bitcoin.networks.testnet;
                break;
            case "signet":
                this.unisatWalletUri = "https://wallet-api-signet.unisat.io";
                this.mempoolUri = "https://mempool.space/signet";
                this.network = bitcoin.networks.testnet;
                break;
            case "fractal":
                this.unisatWalletUri = "https://wallet-api-fractal.unisat.io";
                this.mempoolUri = "https://mempool.fractalbitcoin.io";
                this.network = bitcoin.networks.bitcoin;
                break;
            case "fractal-testnet":
                this.unisatWalletUri = "https://wallet-api-fractal-testnet.unisat.io";
                this.mempoolUri = "https://mempool-testnet.fractalbitcoin.io";
                this.network = bitcoin.networks.bitcoin;
                break;
        }

        switch (this.data.addressType) {
            case "p2tr":
            case "p2wpkh":
                this.addressType = this.data.addressType;
                break;
            default:
                this.addressType = "p2tr";
                break;
        }
    }
}

module.exports = Config;

const fs = require("fs");
const yaml = require('js-yaml');
const bitcoin = require("bitcoinjs-lib");

class Config {
    constructor(filePath = "config.yaml") {
        this.data = yaml.load(fs.readFileSync(filePath, 'utf8'));

        this.URI = this.data.base_url;

        let network = "";
        let networkType = "";
        switch (this.data.base_url) {
            case "https://mempool.space/api":
                networkType = "bitcoin";
                network = bitcoin.networks.bitcoin;
                break;
            case "https://mempool.space/signet/api":
                networkType = "signet";
                network = bitcoin.networks.testnet;
                break;
            case "https://mempool.space/testnet/api":
                networkType = "testnet";
                network = bitcoin.networks.testnet;
                break;
            case "https://mempool.fractalbitcoin.io/api":
            case "https://fractalbitcoin-mempool.unisat.io/api":
                networkType = "fractal";
                network = bitcoin.networks.bitcoin;
                break;
            case "https://mempool-testnet.fractalbitcoin.io/api":
                networkType = "fractal_test";
                network = bitcoin.networks.bitcoin;
                break;
        }

        this.network = network;
        this.networkType = networkType;
    }
}

module.exports = Config;

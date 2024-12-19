const axios = require("axios");
const {logger} = require("./function");

class Request {
    constructor(config) {
        this.config = config;
        this.unisatWalletUri = config.unisatWalletUri;
        this.mempoolUri = config.mempoolUri;
        this.networkType = config.networkType;
    }

    // 获取TX列表
    async getTXs(address) {
        const url = `${this.URI}/address/${address}/txs`;
        const res = await this.request({url: url});
        // status: { confirmed: false } // 该TX是否已确认
        return res.data;
    }

    // 获取TX详情
    async getTXDetail(txHash) {
        const url = `${this.mempoolUri}/tx/${txHash}`;
        const res = await this.request({url: url});
        return res.data;
    }

    async getBalance(address) {
        const url = `${this.unisatWalletUri}/v5/address/summary?address=${address}`;
        const res = await this.request({url: url});
        // {
        //     "code": 0,
        //     "msg": "ok",
        //     "data": {
        //         "totalSatoshis": 2533683544,
        //         "btcSatoshis": 2525186176,
        //         "assetSatoshis": 8497368,
        //         "inscriptionCount": 28318,
        //         "atomicalsCount": 0,
        //         "brc20Count": 0,
        //         "brc20Count5Byte": 0,
        //         "arc20Count": 0,
        //         "runesCount": 0
        //     }
        // }
        if (res && res.data && res.data.data) {
            return res.data.data;
        }
        return null;
    }

    // 查询 UTXO
    async getUTXO(address) {
        const url = `${this.unisatWalletUri}/v5/address/btc-utxo?address=${address}`;
        const res = await this.request({url: url});
        if (res.status === 200 && res.data && res.data.code === 0) {
            return res.data.data;
        }

        return [];
    }

    // 获取建议费用
    async getGas() {
        const configFeeRate = this.config.data.gas;
        let feeRate = 0;
        if (/^\d+\.?\d*$/.test(configFeeRate)) {
            feeRate = Number(configFeeRate)
        } else {
            const url = `${this.unisatWalletUri}/v5/default/fee-summary`;
            const result = await this.request({url: url});
            const res = result.data.data.list;
            logger().info(`当前gas (${res[0].title} = ${res[0].feeRate} sat/vB), (${res[1].title} = ${res[1].feeRate} sat/vB), (${res[2].title} = ${res[2].feeRate} sat/vB)`);
            if (/^\+[1-9]\d*$/.test(configFeeRate)) {
                feeRate = res[2].feeRate + Number(configFeeRate);
            } else {
                switch (configFeeRate) {
                    case "low":
                        feeRate = res[0].feeRate;
                        break;
                    case "medium":
                        feeRate = res[1].feeRate;
                        break;
                    case "high":
                        feeRate = res[2].feeRate;
                        break;
                    default:
                        logger().warn(`config.yaml 的 gas 设置有误，默认使用 high`);
                        feeRate = res[2].feeRate;
                        break;
                }
            }
        }

        logger().info(`使用gas ${feeRate}`);
        return feeRate;
    }

    // 广播交易
    async broadcastTx(psbtHex) {
        const url = `${this.unisatWalletUri}/v5/tx/broadcast`;
        const res = await this.request({
            url: url, method: 'post', body: {
                "rawtx": psbtHex,
            }, headers: {
                'Content-Type': 'application/json',
            }
        });
        return res.data;
    }

    async request({url, method = 'get', body = null, headers = null, agent = null}) {
        const config = {
            url: url,
            method: method,
            timeout: 30 * 1000,
            headers: {
                "accept-language": 'zh-CN,zh;q=0.9',
                "sec-ch-ua": '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
                "sec-ch-ua-mobile": '?0',
                "sec-ch-ua-platform": '"Windows"',
                "sec-fetch-dest": 'empty',
                "sec-fetch-mode": 'cors',
                "sec-fetch-site": 'same-origin',
                "user-agent": 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
            },
        };

        if (headers !== null) {
            config.headers = {...config.headers, ...headers}
        }

        if (body !== null) {
            if (typeof body === 'string') {
                config.data = body;
            } else {
                config.data = JSON.stringify(body);
            }
        }

        if (agent !== null) {
            config.httpsAgent = agent;
            config.httpAgent = agent;
        }

        try {
            const response = await axios(config);
            return response;
        } catch (error) {
            logger().error(`${url} ${error.toString()}`);
            return error.response;
        }
    }

}

module.exports = Request;

const axios = require("axios");
const {logger} = require("./function");

class Request {
    constructor(config) {
        this.config = config;
        this.URI = config.URI;
        this.networkType = config.networkType;
    }

    // 获取TX详情
    async getTXDetail(txHash) {
        const url = `${this.URI}/tx/${txHash}`;
        const res = await this.request({url: url});
        return res.data;
    }

    async getBalance(address) {
        const url = `${this.URI}/address/${address}`;

        const res = await this.request({url: url});
        // funded_txo_sum - spent_txo_sum 就是可用余额
        //{
        //   address: 'tb1ps2d2mfgym39ascmdj5mvyrpm9xrvjt0g7zpdq3ma7ejqxvtqyehqwh00my',
        //   chain_stats: {
        //     funded_txo_count: 2, // 总接受次数
        //     funded_txo_sum: 79795, // 总接收聪
        //     spent_txo_count: 1, // 总发送次数
        //     spent_txo_sum: 70000, // 总发送聪
        //     tx_count: 2, // TX总数
        //   },
        //   mempool_stats: { // 内存池的，就是交易已经发送，还未出块的（未确认的）
        //     funded_txo_count: 0,
        //     funded_txo_sum: 0,
        //     spent_txo_count: 0,
        //     spent_txo_sum: 0,
        //     tx_count: 0
        //   }
        // }
        if (res) {
            return res.data;
        }
        return null;
    }

    // 查询 UTXO
    async getUTXO(address) {
        if (this.networkType === "fractal") {
            const url = `https://wallet-api-fractalbitcoin.unisat.space/v5/address/btc-utxo?address=${address}`;
            const res = await this.request({url: url});
            if (res.status === 200 && res.data && res.data.code === 0) {
                return res.data.data;
            }
        } else {
            // 接口错误，换接口
            const url = `${this.URI}/address/${address}/utxo`;
            const res = await this.request({url: url});
            if (res.status === 200 && res.data && res.data.code === 0) {
                return res.data.data;
            }
        }

        return [];
    }

    // 获取TX列表
    async getTXs(address) {
        const url = `${this.URI}/address/${address}/txs`;
        const res = await this.request({url: url});
        // status: { confirmed: false } // 该TX是否已确认
        return res.data;
    }


    // 获取建议费用
    async getGas() {
        const configFee = this.config.data.fee;
        let gas = 0;
        if (/^[1-9]\d*$/.test(configFee)) {
            gas = Number(configFee)
        } else {
            const url = `${this.URI}/v1/fees/recommended`;
            const result = await this.request({url: url});
            const res = result.data;
            logger().info(`当前gas (High Priority=${res.fastestFee} sat/vB), (Medium Priority=${res.halfHourFee} sat/vB), (Low Priority=${res.hourFee} sat/vB), (No Priority=${res.economyFee} sat/vB)`);
            if (/^\+[1-9]\d*$/.test(configFee)) {
                gas = res.fastestFee + Number(configFee);
            } else {
                switch (configFee) {
                    case "medium":
                        gas = res.halfHourFee;
                        break;
                    case "low":
                        gas = res.hourFee;
                        break;
                    case "high":
                        gas = res.fastestFee;
                        break;
                    default:
                        logger().warn(`config.yaml 的 gas 设置有误，默认使用 high`);
                        gas = res.fastestFee;
                        break;
                }
            }
        }

        logger().info(`使用gas ${gas}`);
        return gas;
    }

    // 广播交易
    async broadcastTx(psbtHex) {
        const url = `${this.URI}/tx`;

        const res = await this.request({
            url: url, method: 'post', body: psbtHex, headers: {
                'Content-Type': 'text/plain'
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
                // 'Origin': 'https://mempool.space',
                'Sec-Ch-Ua': '"Google Chrome";v="125", "Chromium";v="125", "Not.A/Brand";v="24"',
                'Sec-Ch-Ua-Mobile': '?0',
                'Sec-Ch-Ua-Platform': '"Windows"',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
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

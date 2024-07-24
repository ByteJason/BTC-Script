const axios = require("axios");
const bip32 = require('bip32');
const bip39 = require('bip39');
const ecc = require('tiny-secp256k1');
const bitcoin = require('bitcoinjs-lib');
const {ECPairFactory} = require('ecpair');
const {sleep, dd, randomNumber, logger} = require("./utils/function");
const AddressDataClass = require("./utils/AddressData");
const ConfigClass = require("./utils/Config");
const readline = require('node:readline/promises');

bitcoin.initEccLib(ecc);

const config = (new ConfigClass('./config.yaml')).data;
const URI = config.base_url;
let network = "";
let networkType = "";
switch (URI) {
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
}

const exchangeRate = 1e8;

// @apidoc: https://mempool.space/signet/docs/api/rest
// @apidoc: https://mempool.fractalbitcoin.io/zh/docs/api/rest
const toXOnly = (pubKey) => pubKey.length === 32 ? pubKey : pubKey.slice(1, 33);

async function getBalance(address) {
    const url = `${URI}/address/${address}`;

    const res = await request({url: url});
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
async function getUTXO(address) {
    if (networkType === "fractal") {
        const url = `https://wallet-api-fractalbitcoin.unisat.space/v5/address/btc-utxo?address=${address}`;
        const res = await request({url: url});
        if (res.status === 200 && res.data && res.data.code === 0) {
            return res.data.data;
        }
    } else {
        // 接口错误，换接口
        const url = `${URI}/address/${address}/utxo`;
        const res = await request({url: url});
        if (res.status === 200 && res.data && res.data.code === 0) {
            return res.data.data;
        }
    }

    return [];
}

// 获取TX列表
async function getTXs(address) {
    const url = `${URI}/address/${address}/txs`;
    const res = await request({url: url});
    // status: { confirmed: false } // 该TX是否已确认
    return res.data;
}

// 验证地址
async function validationAddress(address) {
    //Address Validation
    const url = `${URI}/v1/validate-address/${address}"`;
    const res = await request({url: url});
    return res.data;
}

// 获取TX详情
async function getTXDetail(txHash) {
    const url = `${URI}/tx/${txHash}`;
    const res = await request({url: url});
    return res.data;
}

async function request({url, method = 'get', body = null, headers = null, agent = null}) {
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

// 获取建议费用
async function getGas() {
    let gas = 0;
    if (/^[1-9]\d*$/.test(config.fee)) {
        gas = Number(config.fee)
    } else {
        const url = `${URI}/v1/fees/recommended`;
        const result = await request({url: url});
        const res = result.data;
        logger().info(`当前gas (High Priority=${res.fastestFee} sat/vB), (Medium Priority=${res.halfHourFee} sat/vB), (Low Priority=${res.hourFee} sat/vB), (No Priority=${res.economyFee} sat/vB)`);
        if (/^\+[1-9]\d*$/.test(config.fee)) {
            gas = res.fastestFee + Number(config.fee);
        } else {
            switch (config.fee) {
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

function getKeyPairByMnemonic(mnemonic) {
    // 通过助记词生成种子
    const seed = bip39.mnemonicToSeedSync(mnemonic);
    // 通过种子生成根秘钥
    const root = bip32.BIP32Factory(ecc).fromSeed(seed, network);
    // 定义路径
    const path = "m/86'/1'/0'/0/0";
    // 通过路径生成密钥对
    const childNode = root.derivePath(path);

    // keyPairInstance
    return ECPairFactory(ecc).fromPrivateKey(childNode.privateKey, {network});
}

function getKeyPairByPrivateKey(privateKey) {
    return ECPairFactory(ecc).fromWIF(privateKey, network);
}

// 转账
async function transfer(keyPair, toAddresses, toAmountSATSAll) {
    const xOnlyPubkey = toXOnly(keyPair.publicKey);

    // 发送方地址
    const {address: fromAddress, output, witness} = bitcoin.payments.p2tr({internalPubkey: xOnlyPubkey, network});

    // 动态查询 UTXO
    const utxoAll = await getUTXO(fromAddress);

    // 如果没有 UTXO，则无法进行转账，返回错误信息
    if (utxoAll.length === 0) {
        return 'No UTXO';
    }

    // TODO: 确认UTXO是否可用（避免误烧和金额不够）
    let availableUTXO = [];
    for (const utxo of utxoAll) {
        if (utxo.value > 546 || utxo.satoshis > 546) {
            availableUTXO.push({
                txid: utxo.txid,
                vout: utxo.vout,
                value: utxo.value && utxo.value > 0 ? utxo.value : utxo.satoshis,
            });
        }
    }
    if (availableUTXO.length === 0) {
        return 'No UTXO';
    }

    // 预估 交易大小=10+输入数量×148+输出数量×34
    let estimateSATS = 10 + (toAddresses.length + 1) * 43 + availableUTXO.length * 148;

    const psbt = new bitcoin.Psbt({network});
    let inputValue = 0;

    let utxoStr = '';
    let i = 1;
    for (const utxo of availableUTXO) {
        if (inputValue < toAmountSATSAll + estimateSATS) {
            const utxoHash = utxo.txid;

            // // 查询 UTXO 对应的交易详情
            // let txDetailOutput = null;
            // const txDetail = await getTXDetail(utxoHash);
            // for (const vout of txDetail.vout) {
            //     if (vout.scriptpubkey_address === fromAddress) {
            //         txDetailOutput = vout;
            //     }
            // }
            //
            // if (txDetailOutput === null) {
            //     logger().error('UTXO Error');
            //     continue;
            // }
            // // 获取输出脚本的十六进制表示
            // const scriptPubKeyHex = txDetailOutput.scriptpubkey_asm;

            const input = {
                // UTXO 的输出索引
                index: utxo.vout,
                // UTXO 的交易哈希
                hash: utxoHash,
                witnessUtxo: {
                    // UTXO 的输出脚本
                    script: output,
                    // UTXO 的金额
                    value: utxo.value,
                },
                tapInternalKey: xOnlyPubkey, // 添加 Taproot 内部密钥
            };
            psbt.addInput(input);

            utxoStr += `    utxo${i}-txid: ${utxoHash}\n`
            i++;

            inputValue += utxo.value;
        }
    }

    let outputValue = 0;
    for (let toAddress of toAddresses) {
        psbt.addOutput({
            // 接收方地址
            address: toAddress.Address,
            // 金额
            value: parseInt(toAddress.Amount * exchangeRate),
        });
        outputValue += parseInt(toAddress.Amount * exchangeRate);
    }

    const gas = await getGas();
    // 设置 gas
    const fee = gas * (10 + (toAddresses.length + 1) * 43 + psbt.data.inputs.length * 148);

    // 找零输出
    const changeValue = inputValue - outputValue - fee;

    if (changeValue < 0) {
        logger().error('可用 UTXO 不足');
        return;
    } else if (changeValue > 0) {
        // 找零
        psbt.addOutput({
            // 接收方地址
            address: fromAddress,
            // 金额
            value: changeValue,
        });
    }

    const tweakedChildNode = keyPair.tweak(
        bitcoin.crypto.taggedHash('TapTweak', xOnlyPubkey),
    );

    // 签名所有输入
    psbt.data.inputs.forEach((input, index) => {
        psbt.signInput(index, tweakedChildNode);
    });

    // // 定义验证函数，用于校验签名是否有效
    // const validator = (pubkey, msghash, signature) => {
    //     return ECPair.fromPublicKey(pubkey).verify(msghash, signature);
    // };
    // // 验证输入签名
    // psbt.validateSignaturesOfInput(0, validator);
    // 终结所有输入，表示签名完成
    psbt.finalizeAllInputs();

    // 提取交易事务
    const psbtHex = psbt.extractTransaction().toHex();

    const psbtSize = Buffer.from(psbtHex, 'hex').length;

    let msg = `\n支出账户: ${fromAddress} 使用了 ${psbt.data.inputs.length} 条 UTXO 作为输入（已经排除了UTXO值小于546的，避免误烧资产）\n`;
    msg += `${utxoStr}`;
    msg += `接收账户数量 ${toAddresses.length} 个地址，共 ${toAmountSATSAll / exchangeRate} BTC ( ${toAmountSATSAll} sat )\n`;
    msg += `矿工费用: ${fee / exchangeRate} BTC ( ${fee} sat )  gas: ${gas.fastestFee} sat/vB\n`;
    msg += `找零 ${changeValue / exchangeRate} BTC ( ${changeValue} sat ) 到 ${fromAddress}\n`;
    console.log(`\x1b[33m${msg}\x1b[39m`);

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    const question = "是否确认将该交易进行广播，广播后将无法反悔交易；输入 'y'或'Y' 并回车确认，其他字符取消广播: ";
    const answer = await rl.question(`\x1b[33m${question}\x1b[39m`);
    rl.close();

    if (answer === 'Y' || answer === 'y') {
        // 广播交易到比特币网络，等待确认
        logger().info(`正在广播交易 hex: ${psbtHex}`);
        const res = await broadcastTx(psbtHex);
        logger().success(`Transaction: ${res}`);
        return true;
    }
    logger().warn('取消广播交易');
    return false;
}

// 广播交易
async function broadcastTx(psbtHex) {
    const url = `${URI}/tx`;

    const res = await request({
        url: url, method: 'post', body: psbtHex, headers: {
            'Content-Type': 'text/plain'
        }
    });
    return res.data;
}

async function main() {
    const toAddresses = await (new AddressDataClass("wallet.csv")).load(['Address', 'Amount']);

    // 支出 sBTC 的账户
    const fromAddressWIF = config.wif;
    const keyPair = getKeyPairByPrivateKey(fromAddressWIF);

    const xOnlyPubkey = toXOnly(keyPair.publicKey);
    // 发送方地址
    const {address: fromAddress, output} = bitcoin.payments.p2tr({internalPubkey: xOnlyPubkey, network});

    let balance = await getBalance(fromAddress);
    let balanceSATS = balance.chain_stats.funded_txo_sum - balance.chain_stats.spent_txo_sum;
    logger().info(`支出账户: ${fromAddress} 余额: ${balanceSATS} sat, ${balanceSATS / exchangeRate} BTC`);

    let toAmountSATSAll = 0;
    for (const index in toAddresses) {
        const {Address, Amount} = toAddresses[index];
        if (!isValidBitcoinAddress(Address)) {
            logger().error(`请检查第${parseInt(index) + 2}行地址: ${Address} 格式是否正确`);
            return
        }
        const amountSATS = parseInt(Amount * exchangeRate);

        toAmountSATSAll += amountSATS;
    }

    if (toAmountSATSAll > balanceSATS) {
        logger().error(`${toAddresses.length} 个收款账户，共 ${toAmountSATSAll / exchangeRate} BTC ( ${toAmountSATSAll} sat ), 余额不足`);
        return
    }

    logger().info(`${toAddresses.length} 个收款账户，共 ${toAmountSATSAll / exchangeRate} BTC ( ${toAmountSATSAll} sat )`);

    let res = false;
    try {
        res = await transfer(keyPair, toAddresses, toAmountSATSAll);
    } catch (e) {
        console.log(e);
        console.log(e.toString());
    }

    if (res === true) {
        logger().success(`转账结果: ${res}`);
    } else {
        logger().error(`转账结果: ${res}`);
    }
}

/**
 * 验证比特币地址的合法性
 * @param {string} address - 要验证的比特币地址
 * @returns {boolean} - 返回地址是否合法
 */
function isValidBitcoinAddress(address) {
    try {
        // 解析比特币地址
        const decoded = bitcoin.address.fromBech32(address);

        // 检查地址前缀和版本号
        if (network === bitcoin.networks.bitcoin) {
            if (decoded.prefix !== 'bc') return false;
        } else if (network === bitcoin.networks.testnet) {
            if (decoded.prefix !== 'tb') return false;
        } else {
            return false;
        }

        // 检查数据部分的长度和类型
        if (address.startsWith('bc1p')) {
            // P2TR 地址的版本号为 1，数据长度为 32 字节
            return decoded.version === 1 && decoded.data.length === 32;
        } else if (address.startsWith('bc1q')) {
            // P2WPKH 地址的版本号为 0，数据长度为 20 字节
            // P2WSH 地址的版本号为 0，数据长度为 32 字节
            return decoded.version === 0 && (decoded.data.length === 20 || decoded.data.length === 32);
        }

        return false;
    } catch (e) {
        // 捕获解析错误，返回地址不合法
        return false;
    }
}

main();


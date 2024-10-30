const bip32 = require('bip32');
const bip39 = require('bip39');
const ecc = require('tiny-secp256k1');
const bitcoin = require('bitcoinjs-lib');
const {ECPairFactory} = require('ecpair');
const {logger, isValidBitcoinAddress, randomNumber} = require("./utils/function");
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

/**
 * 计算转账的交易权重
 * @param inputCount
 * @param outputCount
 * @returns {*}
 */
function calculateWeight(inputCount, outputCount) {
    // 定义每个部分的大小（以字节为单位）
    const baseTransactionSize = 10;    // 包含版本号和锁定时间，通常为10字节
    const inputNonWitnessSize = 70;    // 每个输入的非 Witness 大小
    const outputSize = 58;             // 每个输出的大小

    let nonWitnessSize = baseTransactionSize + (inputCount * inputNonWitnessSize) + (outputCount * outputSize);

    // TODO: 需要根据地址类型判断大小
    // Witness 数据大小
    const p2wpkhWitnessDataSize = 105; // 普通 P2WPKH Witness 数据大小（签名 + 公钥）
    const p2trWitnessDataSize = 64;    // P2TR Witness 数据大小（Schnorr 签名）
    let totalWitnessSize = inputCount * p2trWitnessDataSize; // 计算 Witness 大小

    // 计算交易的总 weight
    return 3 * nonWitnessSize + totalWitnessSize;
}

// 转账
async function transfer(keyPair, toAddresses, toAmountSATSAll) {
    const xOnlyPubkey = toXOnly(keyPair.publicKey);

    // 发送方地址
    const {address: fromAddress, output, witness} = bitcoin.payments.p2tr({internalPubkey: xOnlyPubkey, network});

    // 动态查询 UTXO
    const utxoAll = await request.getUTXO(fromAddress);

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

    const gas = await request.getGas();
    // 设置 gas
    const fee = gas * Math.ceil(calculateWeight(psbt.data.inputs.length, toAddresses.length + 1) / 4);
    console.log(Math.ceil(calculateWeight(psbt.data.inputs.length, toAddresses.length + 1) / 4));

    // 找零输出
    const changeValue = inputValue - outputValue - fee;

    if (changeValue < 0) {
        logger().error('支出超过输出的 UTXO');
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
    const tx = psbt.extractTransaction();
    const psbtHex = tx.toHex();

    let msg = `\n支出账户: ${fromAddress} 使用了 ${psbt.data.inputs.length} 条 UTXO 作为输入（已经排除了UTXO值小于546的，避免误烧资产）\n`;
    msg += `${utxoStr}`;
    msg += `接收账户数量 ${toAddresses.length} 个地址，共 ${toAmountSATSAll / exchangeRate} BTC ( ${toAmountSATSAll} sat )\n`;
    msg += `矿工费用: ${fee / exchangeRate} BTC ( ${fee} sat )  gas: ${gas} sat/vB 虚拟大小: ${tx.virtualSize()}\n`;
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
        const res = await request.broadcastTx(psbtHex);
        logger().success(`Transaction: ` + JSON.stringify(res));
        return true;
    }
    logger().warn('取消广播交易');
    return false;
}

async function main() {
    const toAddresses = await (new AddressDataClass("wallet.csv")).load(['Address', 'Amount']);

    // 支出 sBTC 的账户
    const fromAddressWIF = config.data.wif;
    const keyPair = getKeyPairByPrivateKey(fromAddressWIF);

    const xOnlyPubkey = toXOnly(keyPair.publicKey);
    // 发送方地址
    const {address: fromAddress, output} = bitcoin.payments.p2tr({internalPubkey: xOnlyPubkey, network});

    let balance = await request.getBalance(fromAddress);
    let balanceSATS = 0;
    if (balance && balance.chain_stats) {
        balanceSATS = balance.chain_stats.funded_txo_sum - balance.chain_stats.spent_txo_sum;
        logger().info(`支出账户: ${fromAddress} 余额: ${balanceSATS} sat, ${balanceSATS / exchangeRate} BTC`);
    } else {
        logger().error(`从 RPC 获取余额失败`);
    }

    let toAmountSATSAll = 0;
    for (const index in toAddresses) {
        const {Address, Amount} = toAddresses[index];
        if (!isValidBitcoinAddress(Address, network)) {
            logger().error(`请检查第${parseInt(index) + 2}行地址: ${Address} 格式是否正确`);
            return
        }
        const amountSATS = parseInt(Amount * exchangeRate);
        if (amountSATS <= 0) {
            logger().error(`请检查第${parseInt(index) + 2}行地址: ${Address} 的金额是否正确`);
            return
        }

        toAmountSATSAll += amountSATS;
    }

    if (balance.chain_stats && toAmountSATSAll > balanceSATS) {
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

main();


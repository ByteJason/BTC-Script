const bitcoin = require('bitcoinjs-lib');
const {
    exchangeRate,
    logger,
    isValidBitcoinAddress,
    randomNumber,
    getAddress,
    getKeyPairByWif,
    toXOnly,
    isValidWif,
    calculateWeight,
} = require("./utils/function");
const AddressDataClass = require("./utils/AddressData");
const Request = require("./utils/Request");
const ConfigClass = require("./utils/Config");
const readline = require('node:readline/promises');

const config = new ConfigClass('./config.yaml');
const network = config.network;
const request = new Request(config);

// 转账
async function transfer(wifString, toAddresses, toAmountSATSAll) {
    const keyPair = getKeyPairByWif(wifString, network);
    // 发送方地址
    let fromAddress = getAddress(wifString, config.addressType, network);

    // 动态查询 UTXO
    const availableUTXO = await request.getUTXO(fromAddress);
    if (availableUTXO.length === 0) {
        return 'No UTXO';
    }

    const psbt = new bitcoin.Psbt({network});
    let inputValue = 0;

    const gas = await request.getGas();

    let utxoStr = '';
    let index = 1;
    for (const utxo of availableUTXO) {
        const input = {
            index: utxo.vout,
            hash: utxo.txid,
            witnessUtxo: {
                script: Buffer.from(utxo.scriptPk, 'hex'),
                value: utxo.satoshis,
            }
        }
        if (config.addressType === 'p2tr') {
            input.tapInternalKey = toXOnly(keyPair.publicKey); // 添加 Taproot 内部密钥
        }
        psbt.addInput(input);

        utxoStr += `    utxo${index}-txid: (${utxo.txid}:${utxo.vout} ${utxo.satoshis / exchangeRate} BTC)\n`
        inputValue += utxo.satoshis;

        if (inputValue >= toAmountSATSAll + Math.ceil(gas * calculateWeight(index, toAddresses.length + 1) / 4)) {
            break;
        }
        index++;
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

    // 设置 gas
    const fee = Math.ceil(gas * calculateWeight(psbt.data.inputs.length, toAddresses.length + 1) / 4);
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

    let signer = null;
    if (config.addressType === 'p2tr') {
        signer = keyPair.tweak(
            bitcoin.crypto.taggedHash('TapTweak', toXOnly(keyPair.publicKey)),
        )
    } else {
        signer = keyPair;
    }

    // 签名所有输入
    psbt.data.inputs.forEach((input, index) => {
        psbt.signInput(index, signer);
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
        if (res.code === 0 && res.data.length === 64) {
            logger().success(`广播交易成功，Transaction Hash: ${res.data}`);
            return true;
        }

        logger().error(`广播交易失败: ` + JSON.stringify(res));
        return false;
    }
    logger().warn('取消广播交易');
    return false;
}

async function main() {
    const toAddresses = await (new AddressDataClass("wallet.csv")).load(['Address', 'Amount']);

    // 支出 BTC 的账户
    const fromAddressWIF = config.data.wif.trim();
    if (!isValidWif(fromAddressWIF)){
        logger().error(`wif 私钥有误: ${fromAddressWIF}`);
        return;
    }

    let fromAddress = getAddress(fromAddressWIF, config.addressType, network);

    let balance = await request.getBalance(fromAddress);
    if (balance === null) {
        logger().error(`获取余额失败`);
        return;
    }

    let balanceSATS = 0;
    if (balance) {
        balanceSATS = balance.btcSatoshis;
        logger().info(`支出账户可用: ${fromAddress} 余额: ${balanceSATS} sat, ${balanceSATS / exchangeRate} BTC`);
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

    if (toAmountSATSAll > balanceSATS) {
        logger().error(`${toAddresses.length} 个收款账户，共 ${toAmountSATSAll / exchangeRate} BTC ( ${toAmountSATSAll} sat ), 余额不足`);
        return
    }

    logger().info(`${toAddresses.length} 个收款账户，共 ${toAmountSATSAll / exchangeRate} BTC ( ${toAmountSATSAll} sat )`);

    let res = false;
    try {
        res = await transfer(fromAddressWIF, toAddresses, toAmountSATSAll);
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


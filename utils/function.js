const {createLogger, transports, format} = require('winston');
const bitcoin = require('bitcoinjs-lib');
const bip39 = require("bip39");
const bip32 = require("bip32");

const ecc = require("tiny-secp256k1");
const {ECPairFactory} = require("ecpair");

bitcoin.initEccLib(ecc);

const exchangeRate = 1e8;

/**
 * 睡眠
 * @param seconds
 * @returns {Promise<unknown>}
 */
const sleep = (seconds) => {
    const milliseconds = seconds * 1000;
    return new Promise(resolve => setTimeout(resolve, milliseconds));
};

/**
 * 随机数
 * @param min
 * @param max
 * @returns {number}
 */
function randomNumber(min, max) {
    min = parseInt(min)
    max = parseInt(max)
    // 确保 min 小于等于 max
    if (min > max) {
        [min, max] = [max, min];
    }

    // 计算生成随机整数的范围
    const range = max - min + 1;

    // 生成随机数并将其映射到指定范围内
    return Math.floor(Math.random() * range) + min;
}

/**
 * 打乱数组
 * @param arr
 */
function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1)); //生成[0, i]之间的随机索引
        [arr[i], arr[j]] = [arr[j], arr[i]]; //交换位置
    }
}

/**
 * 获取当前时间
 * @returns {string}
 */
function getCurrentDateTime() {
    const currentDate = new Date();
    const year = currentDate.getFullYear();
    const month = String(currentDate.getMonth() + 1).padStart(2, '0'); // 月份从0开始，需要加1
    const day = String(currentDate.getDate()).padStart(2, '0');
    const hours = String(currentDate.getHours()).padStart(2, '0');
    const minutes = String(currentDate.getMinutes()).padStart(2, '0');
    const seconds = String(currentDate.getSeconds()).padStart(2, '0');

    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

function dd(msg, level = 'info') {
    let formattedMsg = '';

    // 检查参数的类型
    if (typeof msg === 'string' || typeof msg === 'number' || typeof msg === 'boolean') {
        // 如果是字符串、数字或布尔值，直接添加到格式化后的消息中
        formattedMsg += msg;
    } else if (Array.isArray(msg)) {
        // 如果是数组，将数组元素格式化后拼接成字符串
        formattedMsg += msg.map(item => JSON.stringify(item)).join(', ');
    } else if (typeof msg === 'object' && msg !== null) {
        // 如果是对象，将对象转换为字符串格式
        formattedMsg += JSON.stringify(msg);
    }

    formattedMsg = getCurrentDateTime() + ' ' + formattedMsg

    switch (level) {
        case 'success':
            console.log(`\x1b[32m${formattedMsg}\x1b[39m`);
            break;
        default:
        case 'info':
            console.log(`\x1b[34m${formattedMsg}\x1b[39m`);
            break;
        case 'error':
            console.log(`\x1b[41m${formattedMsg}\x1b[49m`);
            break;
        case 'warning':
            console.log(`\x1b[33m${formattedMsg}\x1b[39m`);
            break;
    }
}

/**
 * 返回短地址
 * @param address
 * @param num
 * @returns {*|string}
 */
function shortAddress(address, num = 4) {
    if (address.length <= num * 2) {
        return address;
    } else {
        // 截取前4位和后4位，中间用"***"代替
        return address.slice(0, num + 2) + "***" + address.slice(-num);
    }
}

function logger() {
    const path = require('path');
    // 自定义日志级别，包括 success
    const customLevels = {
        levels: {
            error: 0,
            warn: 1,
            info: 2,
            success: 3,

            http: 4,
            verbose: 5,
            debug: 6,
            silly: 7
        },
        colors: {
            error: 'red',
            warn: 'yellow',
            info: 'blue',
            success: 'green',
            http: 'magenta',
            verbose: 'cyan',
            debug: 'white',
            silly: 'grey'
        }
    };

    const newLogger = createLogger({
        levels: customLevels.levels,
        format: format.combine(
            format.timestamp({format: 'YYYY-MM-DD HH:mm:ss'}),
            format.printf(info => `${info.timestamp} | ${info.level}: ${info.message}`)
        ),
        transports: [
            new transports.Console({
                level: 'success',
                format: format.combine(
                    format.colorize(),
                    format.printf(info => `${info.timestamp} | ${info.level}: ${info.message}`)
                )
            }),
            new transports.File({
                filename: path.join(process.cwd(), 'logs', 'app.log'),
                level: 'success',
                format: format.combine(
                    format.uncolorize(),
                    format.json()
                ),
                maxsize: 5242880, // 5MB
                maxFiles: 5,
            })
        ]
    });

    // 添加颜色
    require('winston').addColors(customLevels.colors);

    return newLogger;
}

function getKeyPairByMnemonic(mnemonic, network, addressType = 'p2tr') {
    // 通过助记词生成种子
    const seed = bip39.mnemonicToSeedSync(mnemonic);
    // 通过种子生成根秘钥
    const root = bip32.BIP32Factory(ecc).fromSeed(seed, network);
    // 定义路径
    const path = addressType === 'p2tr' ? "m/86'/0'/0'/0/0" : "m/84'/0'/0'/0/0";
    // 通过路径生成密钥对
    const childNode = root.derivePath(path);

    // keyPairInstance
    return ECPairFactory(ecc).fromPrivateKey(childNode.privateKey, {network});
}

function isValidWif(wif) {
    const wifRegex = /^[LKc][1-9A-HJ-NP-Za-km-z]{51}$/;
    return wifRegex.test(wif);
}

function getKeyPairByWif(wifString, network) {
    return ECPairFactory(ecc).fromWIF(wifString, network);
}

const toXOnly = (pubKey) => pubKey.length === 32 ? pubKey : pubKey.slice(1, 33);

function getAddress(wifString, addressType, network) {
    const keyPair = getKeyPairByWif(wifString);

    let fromAddress = "";
    if (addressType === "p2tr") {
        const p2tr = bitcoin.payments.p2tr({internalPubkey: toXOnly(keyPair.publicKey), network});
        fromAddress = p2tr.address;
    } else if (addressType === "p2wpkh") {
        const p2wpkh = bitcoin.payments.p2wpkh({pubkey: keyPair.publicKey, network});
        fromAddress = p2wpkh.address;
    } else {
        logger().error(`config.yaml 的 addressType 设置有误， ${addressType}`);
    }

    return fromAddress
}


/**
 * 验证比特币地址的合法性
 * @param {string} address - 要验证的比特币地址
 * @param network
 * @returns {boolean} - 返回地址是否合法
 */
function isValidBitcoinAddress(address, network) {
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
        if (address.startsWith('bc1p')  || address.startsWith('tb1p') ) {
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

module.exports = {
    sleep,
    randomNumber,
    shuffle,
    getCurrentDateTime,
    dd,
    shortAddress,
    logger,
    isValidBitcoinAddress,
    getKeyPairByWif,
    toXOnly,
    getAddress,
    isValidWif,
    exchangeRate,
}

